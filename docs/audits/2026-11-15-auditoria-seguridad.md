# Auditoría de seguridad — 2026-11-15

Alcance: el monorepo completo en `main` @ `1719e45` (app web, worker, paquete `db`, migraciones, deploy, CI y dependencias). Cuatro auditores independientes revisaron cada uno un área (autorización y aislamiento, superficies públicas, ejecución de código/SSRF/inyección, y secretos/cripto/deploy), y en paralelo se corrió `pnpm audit`. Cada hallazgo se verificó contra el código antes de corregirlo, y cada corrección quedó con un test que falla si se revierte.

## Resumen

|                                       | Antes                     | Después                      |
| ------------------------------------- | ------------------------- | ---------------------------- |
| Avisos de dependencias (`pnpm audit`) | 96 (3 críticos, 55 altos) | 1 bajo, sin parche publicado |
| Hallazgos de código críticos/altos    | 5                         | 0                            |
| Hallazgos de código medios            | 17                        | 0                            |
| Tests                                 | 2893                      | 3061, todos en verde         |

**Gate: aprobado.** Ningún S0/S1 abierto. Queda abierto solo SEC-001 (rotación de `app_user`, a cargo del operador), en la sección "Pendiente". Los nueve hallazgos que habían quedado abiertos se cerraron en la rama `fix/audit-pending-2026-11`; las transiciones de compatibilidad y los límites conocidos están más abajo.

## Dependencias

- **better-auth 1.6.33 → 1.7.25**. Avisos críticos/altos: el `state` de OAuth usable como magic link, el proxy de OAuth que permite entrar como otro usuario y la aprobación de dispositivos. Los plugins afectados (magicLink, oauthProxy, deviceAuthorization) no estaban activos, así que no eran explotables en esta configuración, pero la versión quedó actualizada igual. **La 1.7 exige dos columnas nuevas en `two_factor`** (migración 0069); sin ellas, cualquier request de auth falla con "Drizzle schema mismatch".
- **next 15.5.27 → 15.5.29**: RCE sin login en el optimizador de imágenes y DoS en Server Actions. No era alcanzable con esta configuración (sin `dangerouslyAllowSVG` ni `remotePatterns`), pero quedó parchado.
- Resto: MCP SDK, zod, mammoth, testcontainers, vitest, Sentry y undici a sus versiones parchadas. Los transitivos van por `pnpm.overrides`, fijados dentro de su línea mayor: un rango abierto llevó xmldom a 0.9 y rompía la lectura de `.docx`, y lo detectó un test nuevo. esbuild ≥ 0.25 bajo drizzle-kit, con las migraciones verificadas en una base limpia.
- **Aceptado:** deepmerge 4.3.1 (bajo, sin versión parchada). Lo usa `@heroui/theme` para mezclar su config de tema estática, nunca input de usuarios.

## Hallazgos

Severidad según el protocolo: S1 crítico · S2 mayor · S3 menor. Estado: ✓ corregido y verificado con test · ○ pendiente.

### Autorización y aislamiento

En el deploy single-tenant RLS está apagado a propósito, así que los filtros por workspace de la aplicación son el único aislamiento.

| ID        | Sev. | Hallazgo                                                                                                                                                                                                           | Estado                                                           |
| --------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| AUTHZ-001 | S1   | El paso `agent` de un flow cargaba el agente solo por id: un flow de A podía correr el agente de B, con su prompt, sus tools y sus variables. Igual en el destino de un handoff y en la página pública del widget. | ✓                                                                |
| AUTHZ-002 | S2   | Los viewers veían los secretos de los webhooks de flows (con eso podían correr el flow por el webhook público), los secretos de firma de los webhooks salientes y los de los canales.                              | ✓                                                                |
| AUTHZ-003 | S2   | Los workspaces suspendidos o borrados seguían operativos por `requireAuth` y por sus API keys.                                                                                                                     | ✓                                                                |
| AUTHZ-004 | S2   | Un admin podía degradar a un owner y después echarlo.                                                                                                                                                              | ✓                                                                |
| AUTHZ-005 | S3   | La revocación de invitaciones no filtraba por workspace.                                                                                                                                                           | ✓                                                                |
| AUTHZ-006 | S3   | Se guardaban ids de otros workspaces: el agente de un canal, los agentes de un empleado, el equipo y el flow de un agente, el flow de un schedule.                                                                 | ✓                                                                |
| AUTHZ-007 | S3   | `chat_with_agent` por MCP corría agentes en borrador o inactivos.                                                                                                                                                  | ✓                                                                |
| AUTHZ-008 | S2   | El admin de sistema se decidía por email, y el email nunca se verificaba.                                                                                                                                          | ✓ (exige email verificado; las cuentas de email reciben el link) |
| AUTHZ-009 | S3   | El health check contaba la auditoría de todos los workspaces.                                                                                                                                                      | ✓                                                                |

### Ejecución de código, SSRF e inyección

| ID       | Sev. | Hallazgo                                                                                                                                                                                                                                                               | Estado                                                                                                           |
| -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| EXEC-001 | S1   | Conector Postgres: `select 1; commit; delete …` escribía a través de la transacción de solo lectura (verificado: 2 filas → 0; `prepare: true` no lo frena). El chequeo de host aceptaba hosts con `%`-escapes, listas con coma y nombres que resuelven a IPs internas. | ✓                                                                                                                |
| EXEC-002 | S2   | El `endpoint` de los proveedores de IA (Azure, Bedrock, OpenAI-compatible) no tenía guard SSRF.                                                                                                                                                                        | ✓                                                                                                                |
| EXEC-003 | S2   | El cliente de GitLab usaba `fetch` directo después de un chequeo solo de texto, así que el token llegaba a hosts internos.                                                                                                                                             | ✓                                                                                                                |
| EXEC-004 | S2   | Un `.docx` de 100 KB inflaba ~290 MB en la ingesta de conocimiento, y no había tope de subida.                                                                                                                                                                         | ✓                                                                                                                |
| EXEC-005 | S2   | `run_integration` y `flow_call` alcanzan cualquier integración o flow del workspace, no solo los del agente.                                                                                                                                                           | ✓ listas por agente (9238b9a, migración 0071); los agentes nuevos no tienen ninguna hasta configurarlas          |
| EXEC-006 | S3   | El texto no confiable podía cerrar `<untrusted_context>`, y los errores de tools llegaban al modelo sin envolver.                                                                                                                                                      | ✓                                                                                                                |
| EXEC-007 | S3   | Las respuestas HTTP se leían sin tope ni plazo.                                                                                                                                                                                                                        | ✓ (Odoo queda sin tope: sus adjuntos son grandes y el host lo configura un admin)                                |
| EXEC-008 | S3   | La interpolación en el body JSON del nodo HTTP no escapa los valores.                                                                                                                                                                                                  | ✓ los nodos HTTP guardados sin `bodyMode` siguen enviando el body crudo; los nuevos usan JSON escapado (ab31f1b) |
| EXEC-009 | S3   | `agent_call` no tenía límite de profundidad.                                                                                                                                                                                                                           | ✓ (3)                                                                                                            |
| EXEC-010 | S3   | Odoo: con límite de proyectos, un agente podía escribir otros registros con comandos x2many o `partner_ids`.                                                                                                                                                           | ✓                                                                                                                |

### Superficies públicas

| ID      | Sev. | Hallazgo                                                                                                                            | Estado                                                                                                             |
| ------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| PUB-001 | S2   | El token de aprobación de una pausa `wait_human` salía en cada lectura de runs, así que viewers y keys `flows:read` podían aprobar. | ✓                                                                                                                  |
| PUB-002 | S2   | Desde el widget, un visitante anónimo podía llegar por handoff a cualquier agente interno.                                          | ✓                                                                                                                  |
| PUB-003 | S2   | Redirección abierta después del login (`/\t/evil.com`).                                                                             | ✓                                                                                                                  |
| PUB-004 | S2   | Email sin verificar usado para autorizar (ver AUTHZ-008).                                                                           | ✓ parcial: el gate de invitación sigue confiando en el token de la invitación                                      |
| PUB-005 | S3   | Los reintentos de Slack corrían el agente hasta 4 veces por mensaje.                                                                | ✓                                                                                                                  |
| PUB-006 | S3   | El rate limit del widget se esquivaba con `channelId` aleatorios.                                                                   | ✓                                                                                                                  |
| PUB-007 | S3   | Los canales de Telegram viejos sin `secret_token` siguen aceptando requests.                                                        | ✓ firma por canal (18fa208, d15837b); transición `TELEGRAM_ALLOW_UNSIGNED=1`                                       |
| PUB-008 | S3   | El webhook de flows dispara también con GET y la firma no tiene ventana de replay.                                                  | ✓ solo POST, ventana de 300 s (3c26ea5); transición `FLOW_WEBHOOK_ALLOW_GET=1` y `FLOW_WEBHOOK_LEGACY_SIGNATURE=1` |
| PUB-009 | S3   | El transcript del widget devolvía mensajes de sistema.                                                                              | ✓                                                                                                                  |
| PUB-010 | S3   | Los secretos que viajan en URLs quedan en el log de Caddy; Sentry no tiene `beforeSend`.                                            | ✓ Caddy sin URIs en el log y `beforeSend` en Sentry (39e6ad6, 527384d, 1073e66)                                    |
| PUB-011 | S3   | Slack, Telegram y `/api/health` devolvían texto de error interno.                                                                   | ✓                                                                                                                  |

### Secretos, criptografía y deploy

| ID      | Sev. | Hallazgo                                                                                                           | Estado                                                                                                                                                              |
| ------- | ---- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-001 | S1*  | Los roles de 0007 tienen contraseñas que están en el repo público. *Crítico si Postgres es accesible desde afuera. | ✓ parcial: `cron_admin` y `read_only_audit` sin LOGIN (0070); **`app_user` requiere rotación del operador**                                                         |
| SEC-002 | S1   | El script de rotación del runbook dejaba todas las credenciales sin descifrar.                                     | ✓ (borrado; runbook corregido; el re-cifrado falla ante filas rotas)                                                                                                |
| SEC-003 | S2   | = AUTHZ-002.                                                                                                       | ✓                                                                                                                                                                   |
| SEC-004 | S2   | En producción se aceptaban los placeholders de `.env.example` como secretos.                                       | ✓                                                                                                                                                                   |
| SEC-005 | S2   | Las imágenes Docker se llevaban `apps/web/.env`.                                                                   | ✓                                                                                                                                                                   |
| SEC-006 | S2   | El compose de producción tenía `SIGNUP_MODE=open` por defecto, con RLS apagado.                                    | ✓ (`invite`)                                                                                                                                                        |
| SEC-007 | S3   | ~30 handlers autenticados devuelven `e.message`.                                                                   | ✓ públicos y autenticados vía `handleError` (c8380b1, 8bc912b)                                                                                                      |
| SEC-008 | S3   | AES-GCM aceptaba tags de 4 bytes.                                                                                  | ✓                                                                                                                                                                   |
| SEC-009 | S3   | El log de auditoría se puede falsificar o borrar en cascada.                                                       | ✓ HMAC con clave derivada de `ENCRYPTION_SECRET`, marcadores de retención, ancla diaria en el log, sin cascada (fffbe11, 563e34f, d421166, 3f48085; migración 0072) |
| SEC-010 | S3   | GlitchTip con `change-me` como default; los puertos del compose de dev en 0.0.0.0.                                 | ✓                                                                                                                                                                   |
| SEC-011 | S3   | Actions de terceros fijadas por tag, no por SHA; CI sin `permissions`.                                             | ✓ permissions y SHAs (2026-11-22)                                                                                                                                   |
| SEC-012 | S3   | Una key revocada pegada en un doc del plan.                                                                        | ✓ redactada                                                                                                                                                         |
| SEC-013 | S3   | A `safe-log` le faltaban formatos de keys.                                                                         | ✓                                                                                                                                                                   |
| SEC-014 | S3   | Los exports GDPR no se borran después de vencer.                                                                   | ✓ retención de exports vencidos (f24efef)                                                                                                                           |

## Pasos de operación al deployar

1. **Migrar antes de arrancar la app** (`pnpm --filter @orchester/db migrate`): 0065–0072. La 0069 es imprescindible para better-auth 1.7. **La 0072 toma un lock sobre `audit_log` mientras arma un índice: correrla fuera de horario pico.** La 0071 completa las listas de integraciones y flows de cada agente con lo que usó en los últimos 90 días.
2. **Rotar la contraseña de `app_user`** si la base es accesible desde fuera de la red interna. Mientras siga la de fábrica, la app lo avisa en cada arranque.
   ```sql
   ALTER ROLE app_user PASSWORD '<nueva>';
   ```
   Después hay que ponerla en `DATABASE_URL` (o en `APP_DB_PASSWORD` con el compose).
3. **`BETTER_AUTH_SECRET` y `COOKIE_SIGNING_SECRET`**: si alguno quedó con el texto de `.env.example` o tiene menos de 16 caracteres, el servidor no arranca (`openssl rand -base64 32`).
4. **`SIGNUP_MODE`**: el compose de producción ahora toma `invite` por defecto. Para mantener el registro abierto hay que definirlo explícitamente.
5. **Admins de sistema (`ADMIN_EMAILS`)**: necesitan el email verificado. Google ya lo da verificado; las cuentas de email reciben el link al registrarse, o lo pueden pedir con `POST /api/auth/send-verification-email`.
6. **Widget**: un agente sin equipo atendiendo un widget ya no puede hacer handoff. Hay que poner en un mismo equipo a los agentes que se pasan conversaciones.

7. **`AUDIT_V2_SINCE`**: definirla con la fecha y hora del deploy. Las filas anteriores se verifican con el esquema viejo y las posteriores con el HMAC.
8. **Telegram**: después del deploy, correr `pnpm --filter @orchester/web telegram:register-secrets` para dar de alta el `secret_token` de los canales existentes. Hasta entonces se puede deployar con `TELEGRAM_ALLOW_UNSIGNED=1`; sacarla apenas termine el script.
9. **Webhooks de flows**: avisar antes a quien los llame por GET o con la firma vieja. Si hace falta tiempo, deployar con `FLOW_WEBHOOK_ALLOW_GET=1` y/o `FLOW_WEBHOOK_LEGACY_SIGNATURE=1`, y sacarlas en la fecha acordada.
10. **Agentes**: revisar en la pantalla de cada uno las listas de integraciones y flows que armó la 0071. Los agentes nuevos no tienen `run_integration` ni `flow_call` hasta que se configuran.
11. **Ancla de la auditoría**: se escribe una vez por día en el log; guardarla fuera de la base (ver límites conocidos).

## Pendiente

- **SEC-001**: rotar la contraseña de `app_user` (paso 2 de arriba). Lo hace el operador.

## Límites conocidos

- Los webhooks de flows aceptan un replay dentro de la ventana de 300 s.
- Borrar el final de la cadena de auditoría, o la cadena entera, solo se detecta comparando con las anclas del log.
- Las conexiones a Postgres sin `sslmode` siguen en texto plano (sin cambios).
- Las filas de auditoría conservan id, IP y user agent del actor después de borrar al usuario, hasta la retención (365 días).

## Cobertura

| Celda                                                                                        | Estado                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Typecheck, lint, `i18n:check`, `audit-invariants.sh`                                         | ✓                                            |
| Suite completa (unit + integración con Postgres real por testcontainers)                     | ✓ 3061 tests                                 |
| Migraciones en base limpia (drizzle + 30 SQL)                                                | ✓                                            |
| Rol no privilegiado: `app_user` lee las tablas y columnas nuevas; `cron_admin` rechaza login | ✓                                            |
| Build de producción con el entorno del Dockerfile                                            | ✓                                            |
| Migraciones sobre datos de producción                                                        | NO CUBIERTO (sin acceso a la base)           |
| Exploits contra el deploy real                                                               | NO CUBIERTO (solo código y entornos locales) |
| Plugins de better-auth no activos en esta config                                             | NO CUBIERTO (fuera de uso)                   |

## Límites

La auditoría lee el código y lo prueba localmente. No vio el entorno de producción: el hosting, si Postgres es accesible desde afuera, las variables reales ni el estado de las tablas. Esos puntos quedan como pasos de operación.
