# Runbook — Orchester

> Qué hacer cuando algo se rompe. Cada sección tiene síntomas, diagnóstico
> rápido y solución. Si el problema no está acá, agregalo después de
> resolverlo.

## Tabla de contenidos

- [Health check tira 503](#health-check-tira-503)
- [Los agentes no responden](#los-agentes-no-responden)
- [Rate-limit (429) constante](#rate-limit-429-constante)
- [DB lenta o lockeada](#db-lenta-o-lockeada)
- [Worker no procesa flows](#worker-no-procesa-flows)
- [Backup falla](#backup-falla)
- [Sospecho compromise de credenciales](#sospecho-compromise-de-credenciales)
- [Sospecho compromise de la DB](#sospecho-compromise-de-la-db)
- [Webhook saliente falla repetido](#webhook-saliente-falla-repetido)
- [El secret commiteado por accidente](#el-secret-commiteado-por-accidente)
- [Restore de backup tras DB destruida](#restore-de-backup-tras-db-destruida)
- [Encryption secret rotation](#encryption-secret-rotation)
- [Migración entre regiones](#migración-entre-regiones)

---

## Health check tira 503

**Síntomas:** `curl /api/health` devuelve 503.

**Diagnóstico:**

```bash
curl -s $DOMAIN/api/health | jq .
# → ver qué `check` está rojo
```

| Check rojo  | Causa más probable                     | Fix                                                                                                              |
| ----------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `db_ping`   | Postgres caído o connection string mal | `pg_isready -d "$DATABASE_URL"`. Restart Postgres si es local. Verificá password rotado.                         |
| `db_schema` | schema sin aplicar                     | `pnpm --filter @orchester/db migrate` (la migración baseline ya corre `CREATE EXTENSION IF NOT EXISTS vector;`). |

Si `db_ping` ok pero el latency es >1000ms (warning): mirá `pg_stat_activity` por queries lentas, vacuum.

---

## Los agentes no responden

**Síntomas:** `/agents/[id]/test-chat` cuelga o devuelve 500. El banner
"proveedor de IA está desconectado" aparece.

**Diagnóstico:**

```bash
# 1. ¿Hay provider configurado?
curl -s "$DOMAIN/api/providers?summary=1" --cookie "session=..." | jq .
# Esperás: { configured: true, sources: [{provider:"anthropic", source:"db"}], ... }

# 2. ¿La key es válida?
# Probá con curl directo a anthropic:
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

Causas + fixes:

- **"credit balance too low":** carga créditos en https://console.anthropic.com/settings/plans
- **"invalid x-api-key":** la key se rotó del lado del provider. Genera una nueva y pegala en `/settings#providers`.
- **Rate-limit del provider (429):** bajá el `concurrency` del worker o pasale a un model más barato (`claude-haiku-4-5`).
- **Timeout:** aumentá el timeout en `lib/llm-call.ts` o cambialá a streaming (TODO).

---

## Rate-limit (429) constante

**Síntomas:** los users ven `429 Too Many Requests` en el dashboard.

**Diagnóstico:**

```bash
curl -I "$DOMAIN/api/agents/[id]/test-chat" -X POST ...
# Headers a buscar: x-ratelimit-remaining: 0, retry-after: 60
```

Causas:

- **Single-user hammering:** revisá `audit_log` por actividad extraña (`/settings#audit`). Si fue compromise, ver "Sospecho compromise de credenciales".
- **Multi-replica con in-memory limiter:** cada réplica tiene su propio bucket → un atacante hace N×replicas requests reales. Solución: swap a Redis adapter (`scripts/install-rate-limit-redis.md` — TBD; manualmente: `lib/rate-limit-redis.ts`).
- **Bucket capacity demasiado bajo para tráfico real:** edita `RATE_LIMITS` en `lib/rate-limit.ts` (LLM_HEAVY default 30/min).

---

## DB lenta o lockeada

**Síntomas:** TTFB > 2s, dashboard tarda en cargar.

**Diagnóstico:**

```sql
-- Queries activas
SELECT pid, now() - query_start AS dur, state, query
FROM pg_stat_activity WHERE state != 'idle' ORDER BY dur DESC LIMIT 10;

-- Locks
SELECT * FROM pg_locks WHERE NOT granted;

-- Tamaño de tablas
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
```

Fixes comunes:

- Falta vacuum: `VACUUM ANALYZE;` (autovacuum debería hacerlo solo).
- Falta index hot: ver `packages/db/sql/init-indices.sql`.
- `message` table gigante: aplicá retention (cron de limpieza de conversations cerradas >180 días, TODO).
- Connection pool exhausted: subí `max_connections` en Postgres + ajustá pool en `packages/db/src/client.ts`.

---

## Worker no procesa flows

**Síntomas:** flow runs quedan en `status="pending"` para siempre. `/flows/[id]` historial vacío.

**Diagnóstico:**

```bash
# ¿Worker corriendo?
docker compose ps worker
# o
ps aux | grep worker

# ¿Hay jobs encolados?
psql "$DATABASE_URL" -c "SELECT name, state, count(*) FROM pgboss.job GROUP BY 1,2 ORDER BY 1,2"
```

Fixes:

- **Worker crasheó:** `docker compose restart worker` o `pnpm --filter web worker:prod` manual. Mirá los logs por `[queue] handler ... threw`.
- **Jobs en `failed`:** los retry-3-veces ya pasaron. Limpiá: `DELETE FROM pgboss.archive WHERE state='failed' AND completedon < now() - interval '7 days'`.
- **No hay jobs encolados pero los flows no corren:** el caller no está usando `enqueue()`. Verificá `lib/channels/router.ts` y endpoints de flows.

---

## Backup falla

**Síntomas:** `./scripts/backup.sh` exit code != 0 o el log muestra errores.

**Diagnóstico:**

```bash
# Probá manualmente
DATABASE_URL=... ./scripts/backup.sh
```

Causas:

- **`pg_dump: error: connection failed`:** mismo problema que health check. Ver "Health check tira 503".
- **`No space left on device`:** liberar disco o aumentar el volume; `RETAIN_DAYS=7` (default 14) reduce.
- **`mc: command not found`:** instalá `mc` ( https://min.io/docs/minio/linux/reference/minio-mc.html ) o setteá sólo `DATABASE_URL` (skip MinIO).

---

## Backups & DR

**Cron:** `./scripts/backup.sh` corre diario a las 03:00 vía crontab:

```cron
0 3 * * *  cd /opt/orchester && ./scripts/backup.sh >> /var/log/orchester-backup.log 2>&1
```

Hace `pg_dump → gzip` en `BACKUP_DIR` (default `./backups`) y, si hay MinIO,
copia el bucket. Retención: `RETAIN_DAYS=14` por default.

**Verificación periódica:**

- Revisar `/var/log/orchester-backup.log` semanalmente (exit code 0 + archivo nuevo).
- Confirmar que el `.sql.gz` del día existe y pesa lo esperado.

**Recordatorio de restore-rehearsal:** un backup que nunca se restauró no es un
backup. Ensayar el restore en un entorno limpio **al menos una vez por trimestre**
siguiendo "Restore de backup tras DB destruida" más abajo, y anotar la fecha del
último ensayo exitoso. Si pasaron más de 3 meses sin ensayo, agendalo.

---

## Sospecho compromise de credenciales

Procedimiento (tomá 5 minutos):

1. **Cerrar todas las sesiones del user afectado:**
   ```bash
   curl -X DELETE "$DOMAIN/api/sessions?all=true" --cookie "session=user-affected"
   ```
   o desde UI: `/settings#sessions` → "Cerrar todas las otras sesiones".
2. **Forzar reset de password** del user (better-auth flow estándar).
3. **Activar 2FA** si no estaba: `/settings#account → Activar 2FA`.
4. **Auditar acciones recientes:** `/settings#audit` filtrá por `userId` del afectado, mirá últimas 24-72h.
5. Si hay `provider.create` o `provider.update` no esperado:
   - **Rotar la key del provider** en su dashboard (Anthropic/OpenAI/etc.)
   - Quitarla de Orchester en `/settings#providers`.

---

## Sospecho compromise de la DB

Procedimiento de emergencia:

1. **Cortar acceso a la DB** desde internet (firewall/security group).
2. **Rotar `ENCRYPTION_SECRET`** — todas las API keys cifradas se vuelven inservibles para el atacante:
   ```bash
   DATABASE_URL=... ENCRYPTION_SECRET=<viejo> ./scripts/rotate-encryption-secret.sh
   ```
   Actualizar `ENCRYPTION_SECRET` en config + reiniciar web/worker.
3. **Forzar logout global** (todos los users vuelven a loguear):
   ```sql
   DELETE FROM session;
   ```
4. **Auditar `audit_log` completo** del periodo afectado.
5. **Notificar a usuarios** afectados — requerimiento legal (GDPR Article 33,
   72 horas tras detection).
6. **Restore desde último backup limpio** si los datos se manipularon (ver
   "Restore de backup tras DB destruida").

---

## Webhook saliente falla repetido

**Síntomas:** `webhook_delivery` con `status="failed"`, mismo `webhook.url` repetido.

**Diagnóstico:**

```sql
SELECT url, last_error, failure_count, last_error_at
FROM outbound_webhook
WHERE failure_count > 5
ORDER BY last_error_at DESC;
```

Fixes:

- **`HTTP 401/403`:** el endpoint del cliente cambió la auth. Pedile la nueva URL o disable el webhook.
- **`ECONNREFUSED`:** el server está caído. El jitter retry de
  `lib/webhooks-out.ts` ya intenta hasta 3 veces — si después sigue
  fallando, pausá el webhook (`enabled=false`).
- **Volume de errores:** mirá los últimos 100 events del webhook en `webhook_delivery`.

---

## El secret commiteado por accidente

Pasos (en orden, importante):

1. **NO** edites el archivo y hagas otro commit. El secret ya está en git history.
2. **Rotá el secret real** (Anthropic console, etc.) inmediatamente. La parte real comprometida.
3. Si el repo es privado y muy reciente: `git filter-repo --invert-paths --path <archivo>` + `git push --force-with-lease`. Avisá al equipo, todos deben re-clonar.
4. Si el repo es público o tiene mucho history: el secret está en internet. Asume comprometido.
5. Agregá el patrón al `[allowlist]` de `.gitleaks.toml` SOLO si era falso positivo. Si era real, NO.

Para que no vuelva a pasar:

```bash
./scripts/install-git-hooks.sh   # pre-commit gitleaks
```

---

## Restore de backup tras DB destruida

```bash
# 1. Levantá Postgres limpio
docker compose down postgres
docker volume rm orchester_postgres-data
docker compose up -d postgres

# 2. Reinstalá pgvector
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector"

# 3. Restaurá el backup
gunzip -c backups/db-2026-05-07-0300.sql.gz | psql "$DATABASE_URL"

# 4. Verificá
psql "$DATABASE_URL" -c "SELECT count(*) FROM workspace"
psql "$DATABASE_URL" -c "SELECT count(*) FROM agent"

# 5. Levantá web + worker
docker compose up -d web worker

# 6. Smoke test
curl -f $DOMAIN/api/health | jq .
```

Si tenés MinIO también restorealo (`mc mirror backups/minio-2026-05-07-0300/ local/orchester`).

---

## Encryption secret rotation

Procedimiento de zero-downtime imposible — necesita stop-the-world breve.

```bash
# 1. Pausá el tráfico (maintenance mode o cierra el firewall a 443)
# 2. Pausá web + worker
docker compose stop web worker

# 3. Rota el secret
DATABASE_URL=... ENCRYPTION_SECRET=<viejo> ./scripts/rotate-encryption-secret.sh
# El script imprime el nuevo. Pegalo en .env / secret manager.

# 4. Levantá web + worker con el nuevo
docker compose up -d web worker

# 5. Smoke: que un agente test-chat funcione (= la key del provider se descifró bien)
```

Si la rotación falla a la mitad: **NO panic**. La tabla queda mixed (algunas
filas con secret nuevo, otras viejo). Sólo levantá la app con el secret VIEJO
y volvé a correr el script. Es idempotente por diseño (cada fila se procesa
individualmente con su propio iv).

---

## Migración entre regiones

Outline (sin script automatizado todavía):

1. Backup en región A.
2. Provisión nueva en región B (DB, MinIO, web, worker, secret manager).
3. Restore.
4. DNS swap (`dig +short A...` → IP de B).
5. Decommission A después de 7 días.
