#!/usr/bin/env bash
#
# provision.sh — Bootstrap de un VPS Ubuntu/Debian limpio para Orchester.
#
# Idempotente: podés correrlo varias veces. Instala Docker + Compose, hardening
# básico de firewall, crea el usuario de deploy y deja el repo listo para
# `docker compose -f docker-compose.prod.yml up -d`.
#
# Uso (como root en un VPS recién creado):
#   curl -fsSL https://raw.githubusercontent.com/orchester-io/orchester/main/scripts/provision.sh | bash
# o:
#   sudo ./scripts/provision.sh
#
# Variables (opcionales):
#   DEPLOY_USER   usuario no-root a crear/usar     (default: orchester)
#   REPO_URL      repo a clonar                    (default: github.com/orchester-io/orchester)
#   APP_DIR       dónde clonar                     (default: /opt/orchester)
#   SSH_PORT      puerto SSH para abrir en ufw     (default: 22)

set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-orchester}"
REPO_URL="${REPO_URL:-https://github.com/orchester-io/orchester.git}"
APP_DIR="${APP_DIR:-/opt/orchester}"
SSH_PORT="${SSH_PORT:-22}"

log()  { echo -e "\033[1;36m▶ $1\033[0m"; }
ok()   { echo -e "  \033[1;32m✓\033[0m $1"; }
warn() { echo -e "  \033[1;33m⚠\033[0m $1"; }
die()  { echo -e "  \033[1;31m✗\033[0m $1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Corré como root (sudo ./scripts/provision.sh)"

. /etc/os-release 2>/dev/null || die "No pude leer /etc/os-release"
case "${ID:-}" in
  ubuntu|debian) ok "OS soportado: $PRETTY_NAME" ;;
  *) warn "OS no testeado ($PRETTY_NAME) — seguimos igual" ;;
esac

log "Actualizando paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw fail2ban >/dev/null
ok "base + git + ufw + fail2ban"

log "Instalando Docker (si falta)"
if command -v docker >/dev/null 2>&1; then
  ok "Docker ya instalado ($(docker --version | awk '{print $3}' | tr -d ,))"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  systemctl enable --now docker >/dev/null 2>&1 || true
  ok "Docker + Compose plugin instalados"
fi

log "Usuario de deploy: $DEPLOY_USER"
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  ok "usuario $DEPLOY_USER ya existe"
else
  adduser --disabled-password --gecos "" "$DEPLOY_USER" >/dev/null
  ok "usuario $DEPLOY_USER creado"
fi
usermod -aG docker "$DEPLOY_USER"
ok "$DEPLOY_USER agregado al grupo docker"

log "Firewall (ufw)"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ok "ufw activo: permitido SSH($SSH_PORT), 80, 443"

systemctl enable --now fail2ban >/dev/null 2>&1 || true
ok "fail2ban activo (protección SSH brute-force)"

log "Clonando repo en $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only >/dev/null 2>&1 && ok "repo actualizado" || warn "no pude fast-forward — revisá manualmente"
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR" >/dev/null 2>&1
  ok "repo clonado"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
  if [ -f "$APP_DIR/scripts/generate-secrets.sh" ]; then
    log "Generando .env con secretos"
    sudo -u "$DEPLOY_USER" bash -c "cd '$APP_DIR' && cp .env.example .env && ./scripts/generate-secrets.sh >> .env" 2>/dev/null \
      && ok ".env creado (REVISÁ DATABASE_URL / NEXT_PUBLIC_APP_URL antes de levantar)" \
      || warn "no pude autogenerar .env — copialo de .env.example manualmente"
  else
    warn "scripts/generate-secrets.sh no está — creá .env manualmente"
  fi
else
  ok ".env ya existe (no lo toco)"
fi

echo ""
log "Provisioning completo. Próximos pasos:"
cat <<EOF
  1. su - $DEPLOY_USER && cd $APP_DIR
  2. nano .env            # configurá DATABASE_URL, NEXT_PUBLIC_APP_URL, provider keys
  3. ./scripts/preflight.sh
  4. docker compose -f docker-compose.prod.yml up -d
  5. ./scripts/go-live.sh https://tu-dominio.com
EOF
