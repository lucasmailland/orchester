#!/usr/bin/env bash
#
# backup.sh — Backup completo de Orchester (Postgres + MinIO).
#
# Uso (manual):
#   ./scripts/backup.sh
#
# Uso (cron, diario 03:00):
#   crontab -e
#   0 3 * * *  cd /opt/orchester && ./scripts/backup.sh >> /var/log/orchester-backup.log 2>&1
#
# Variables esperadas:
#   BACKUP_DIR   — destino local (default: ./backups)
#   RETAIN_DAYS  — cuántos días retener (default: 14)
#   DATABASE_URL — postgres://...
#   S3_ENDPOINT  — MinIO endpoint (opcional; si no, salteamos)
#   S3_BUCKET    — bucket a copiar (opcional)
#
# El script:
#   1. pg_dump → gzip → ${BACKUP_DIR}/db-YYYY-MM-DD-HHMM.sql.gz
#   2. mc mirror MinIO → ${BACKUP_DIR}/minio-YYYY-MM-DD-HHMM/
#   3. Borra backups más viejos que RETAIN_DAYS
#   4. (opcional) sube a S3 remoto si REMOTE_S3_URL está setteado
#
# Para restaurar:
#   gunzip -c db-2026-05-07-0300.sql.gz | psql "$DATABASE_URL"

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
TIMESTAMP="$(date +%Y-%m-%d-%H%M)"

mkdir -p "$BACKUP_DIR"

# 1. Postgres
if [ -n "${DATABASE_URL:-}" ]; then
  echo "[backup] Postgres → ${BACKUP_DIR}/db-${TIMESTAMP}.sql.gz"
  pg_dump --no-owner --no-acl --clean --if-exists "$DATABASE_URL" \
    | gzip > "${BACKUP_DIR}/db-${TIMESTAMP}.sql.gz"
  echo "[backup] Postgres OK ($(du -h "${BACKUP_DIR}/db-${TIMESTAMP}.sql.gz" | cut -f1))"
else
  echo "[backup] DATABASE_URL not set — skipping postgres"
fi

# 2. MinIO (opcional)
if [ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_BUCKET:-}" ] && command -v mc >/dev/null 2>&1; then
  echo "[backup] MinIO → ${BACKUP_DIR}/minio-${TIMESTAMP}/"
  mc mirror --quiet \
    "${S3_BUCKET_ALIAS:-local}/${S3_BUCKET}" \
    "${BACKUP_DIR}/minio-${TIMESTAMP}/"
  echo "[backup] MinIO OK ($(du -sh "${BACKUP_DIR}/minio-${TIMESTAMP}" | cut -f1))"
else
  echo "[backup] MinIO no configurado o mc no instalado — skipping"
fi

# 3. Cleanup de backups viejos (>RETAIN_DAYS)
find "$BACKUP_DIR" -maxdepth 1 -name "db-*.sql.gz" -mtime +${RETAIN_DAYS} -delete 2>/dev/null || true
find "$BACKUP_DIR" -maxdepth 1 -name "minio-*" -type d -mtime +${RETAIN_DAYS} -exec rm -rf {} + 2>/dev/null || true

# 4. Upload a S3 remoto opcional
if [ -n "${REMOTE_S3_URL:-}" ]; then
  echo "[backup] Subiendo a remoto $REMOTE_S3_URL"
  aws s3 cp "${BACKUP_DIR}/db-${TIMESTAMP}.sql.gz" "${REMOTE_S3_URL}/db/" --quiet
fi

echo "[backup] Done — $TIMESTAMP"
