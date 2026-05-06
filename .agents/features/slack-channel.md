# Slack Channel

> Estado: implementado · Owner: platform · Última edición: 2026-05-06

## Planning

**Objetivo:** permitir que un agente de Orchester atienda DMs y menciones en Slack, ida y vuelta, persistiendo cada conversación bajo el modelo unificado del workspace.

**Por qué:** Slack es el canal #1 de equipos B2B. Hasta ahora `/integrations` mostraba todo "Próximamente" — eso fue deuda visible. Slack es la integración con mejor ratio impacto/complejidad: la API es estable, el modelo es similar a Telegram (que ya estaba), y abre la puerta para que la sección integraciones tenga al menos UNA cosa que funcione.

**Restricciones:**
- Sin SDK gigante. Web API directa con `fetch`.
- Cero dependencia de webhooks reverse-tunnel: el operator pega la URL pública en api.slack.com manualmente (la app debe correr en un dominio accesible).
- Verificación criptográfica de cada request (HMAC SHA256 con `signing_secret`).
- Anti-loop: ignorar `bot_message` para que no nos auto-respondamos.

## Componentes

| Componente | Archivo | Rol |
| --- | --- | --- |
| Adapter | `apps/web/lib/channels/slack.ts` | `slackSend`, `slackAuthTest`, `verifySlackSignature`, types |
| Webhook entrante | `apps/web/app/api/channels/slack/webhook/[secret]/route.ts` | recibe events, verifica firma, dispatcha a `handleInbound` |
| Webhook config (test) | `apps/web/app/api/channels/[id]/route.ts` | rama `slack`: testea bot token con `auth.test`, devuelve `webhookUrl` para que el operador la pegue en api.slack.com |
| Outbound manual | `apps/web/app/api/conversations/[id]/reply/route.ts` | rama `slack`: usa `slackSend` con `thread_ts` |
| UI | `apps/web/app/[locale]/(shell)/integrations/page.tsx` | tarjeta verde "Disponible" linkeada a `/channels` |

## Setup que hace el operador

1. Crear app en https://api.slack.com/apps
2. OAuth scopes mínimos: `chat:write`, `app_mentions:read`, `im:history`, `im:read`, `im:write`
3. Install to workspace → copiar **Bot User OAuth Token** (`xoxb-...`)
4. Basic Information → copiar **Signing Secret**
5. En Orchester `/channels` → "Nuevo canal" → tipo Slack → pegar bot token + signing secret
6. La respuesta del PATCH incluye `webhookUrl` — pegarla en Slack:
   - Event Subscriptions → Enable Events → Request URL = `https://tu-dominio.com/api/channels/slack/webhook/<secret>`
   - Subscribe to bot events: `message.im`, `app_mention`
7. Asignar un agente al canal en Orchester
8. Listo: cualquier DM al bot o `@bot` en un canal dispara el agente

## Decisiones clave

- **`externalId = "<slack_channel>:<thread_ts>"`** — cada thread es su propia conversación. DMs comparten el mismo channel id pero distintos `ts`, así que cada conversación queda atada al primer mensaje.
- **No auto-config del Event Subscriptions URL.** Slack no expone API para hacerlo programático sin ser app oficial (App Manifest API). Se le devuelve la URL al operador para que la pegue.
- **Tolerancia de timestamp = 5 min** contra replay attacks.
- **`crypto.timingSafeEqual`** para comparar firmas — defensa contra timing oracles.
- **Verificación con `rawBody`**, NO con JSON.stringify(parsed). Slack firma el cuerpo exacto recibido y cualquier reorder de keys rompe el HMAC.

## Execution log

### 2026-05-06 — implementación inicial

- ✅ `lib/channels/slack.ts`: adapter con `slackSend`, `slackAuthTest`, `verifySlackSignature` + tipos `SlackCredentials` y `SlackEventEnvelope`
- ✅ `api/channels/slack/webhook/[secret]/route.ts`: handler con `url_verification`, anti-loop bot_message, dispatch a router
- ✅ `api/channels/[id]/route.ts`: rama Slack en PATCH valida con `auth.test` y devuelve webhookUrl
- ✅ `api/conversations/[id]/reply/route.ts`: outbound manual via `slackSend(thread_ts)`
- ✅ `integrations/page.tsx`: card "Disponible" verde linkeada a `/channels`

### Pendientes

- [ ] Soporte de bloques de Slack (Block Kit) — hoy solo texto plano
- [ ] Reacciones (`reactions:write`) para feedback rápido
- [ ] Typing indicator (no tiene API directa pero hay workarounds)
- [ ] Quitar mensaje del bot del rate-limit de tier 3 (1/sec) → batch agent replies
