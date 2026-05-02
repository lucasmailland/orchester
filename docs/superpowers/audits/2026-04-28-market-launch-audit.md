# Orchester — Auditoría Pre-Launch & Roadmap a Producto de Mercado

**Fecha:** 2026-04-28
**Estado actual:** MVP funcional con base sólida — no es producto vendible.
**Objetivo:** Plan accionable y priorizado para llegar a producto que un cliente pague.

---

## 1. Resumen ejecutivo

Hoy Orchester tiene los **cimientos correctos**: auth, multi-tenancy, schema en Drizzle, un Agent Studio, un Flow Builder visual con motor server-side, un Organigrama interactivo, y AI providers multi-vendor. **Falta convertir esos cimientos en producto.**

Las 4 brechas críticas que bloquean el lanzamiento son:

1. **Los agentes son cajas negras** — sólo tienen un prompt de texto. No hay tools, no hay knowledge base, no hay memoria, no hay forma de elegir si un agente es conversacional o flujo.
2. **El flow builder es un demo** — sólo trigger manual, sin loops, sin try/catch, sin auth en HTTP, sin notify real, sin streaming, sin templates, sin debugger.
3. **No hay integración real con el mundo** — la página de Canales está vacía, no hay widget web, no hay WhatsApp/Slack/Email, no hay webhooks entrantes, no hay API pública.
4. **Falta toda la capa de producto** — sin RBAC enforcement, sin billing, sin rate limiting, sin observability, sin invites, sin reset password, sin toasts, sin mobile, sin legal.

Este documento audita cada capa, asigna severidad, y propone un roadmap de 8 fases priorizado por bloqueos de mercado.

---

## 2. Inventario actual

### 2.1 Schema (17 tablas)
| Tabla | Estado | Notas |
|---|---|---|
| `user`, `session`, `account`, `verification` | ✅ better-auth | Sin 2FA, sin PKCE custom |
| `workspace`, `workspace_member` | ✅ | `role` existe pero no se enforce |
| `team` | ✅ | OK |
| `agent` | ⚠️ | **Falta:** kind, flowId, tools, variables, avatar, greeting, fallback, voice, eval |
| `agent_version` | ✅ | Snapshot básico |
| `channel` | ⚠️ | Schema existe, pero página vacía y sin lógica |
| `employee` | ✅ | Tiene assignedAgentIds |
| `conversation`, `message` | ⚠️ | Schema OK, pero sin detail view, sin takeover, sin tags |
| `ai_provider` | ✅ | 4 providers, encryption AES-256-GCM |
| `flow`, `flow_run`, `flow_run_step` | ⚠️ | **Falta:** versioning, templates, scheduled, webhook |

### 2.2 Routes (19 páginas, 19 endpoints)
- `(shell)`: home, agents, conversations, employees, teams, teams/[id], org, channels (vacío), integrations (vacío), flows, settings, usage
- `(auth)`: login, signup
- Full-screen: agents/[id] studio, flows/[id] builder, onboarding
- API: providers (CRUD+test), agents (CRUD+versions+generate-prompt+test-chat), flows (CRUD+run+runs), flow-runs/[id], org-graph, employees/[id]/agents, teams (CRUD), auth/[...all]

### 2.3 Auth
- better-auth con email/password + Google OAuth opcional
- `requireEmailVerification: false` ← **debe ir a true en producción**
- No hay UI de password reset / verify email / 2FA / sessions
- No hay invite flow
- No enforcement de roles en endpoints

### 2.4 Tests
46/46 verde. Cobertura: encryption, providers, flow-engine, promptQuality, db-queries, motion, i18n routing, middleware. Falta: e2e, integraciones de proveedor mockeadas, flow execution end-to-end.

---

## 3. Auditoría por área (severidad ⛔ bloqueante / ⚠️ importante / 💡 mejora)

### 3.1 Configuración del Agente

| # | Gap | Severidad | Por qué bloquea |
|---|---|:-:|---|
| A1 | No existe `agent.kind` (conversational \| flow) | ⛔ | El usuario dijo: *"cada agente puede tener un prompt conversacional o estar creado con un flujo interno"*. Sin esto no hay producto. |
| A2 | No hay tools/function calling | ⛔ | Un agente sin tools no puede actuar (consultar API, calcular, buscar). Compite directo con ChatGPT — pierde. |
| A3 | No hay knowledge base / RAG | ⛔ | Caso de uso #1 de empresas: "que el agente sepa de mi empresa". Imposible hoy. |
| A4 | No hay memoria persistente entre conversaciones | ⚠️ | El usuario tiene que repetir contexto cada vez |
| A5 | No hay variables/secrets por agente | ⚠️ | No se puede personalizar por cliente sin tocar el prompt |
| A6 | No hay greeting/fallback/conversation starters | ⚠️ | UX pobre en el primer contacto |
| A7 | No hay avatar / branding del agente | 💡 | Importante para white-label |
| A8 | No hay eval suites / testing automatizado | ⚠️ | Sin esto cualquier cambio puede romper el agente en producción |
| A9 | No hay output schema (JSON validation) | ⚠️ | Cuando el flujo espera un score, el agente puede devolver markdown |
| A10 | No hay guardrails (PII redaction, profanity filter, prompt injection guard) | ⚠️ | Riesgo legal y reputacional |
| A11 | No hay voz (STT/TTS) | 💡 | Diferenciador, no bloqueante |
| A12 | No hay multi-turn config (max turns, timeout) | ⚠️ | Conversaciones sin límite consumen tokens infinitos |

### 3.2 Flow Builder

| # | Gap | Severidad | Por qué bloquea |
|---|---|:-:|---|
| F1 | Sólo trigger manual | ⛔ | Sin webhook/schedule no hay automatización real |
| F2 | Sin loops (for-each, while) | ⛔ | No se pueden procesar listas |
| F3 | Sin paralelismo (fork/join) | ⚠️ | Latencia alta cuando se podrían correr en paralelo |
| F4 | Sin try/catch/fallback | ⛔ | Un nodo que falla rompe todo el flujo |
| F5 | Sin nodo Code (JS/Python expression) | ⛔ | Cualquier transformación no trivial necesita código |
| F6 | Sin subflows | ⚠️ | DRY imposible |
| F7 | Sin wait-for-human (HITL) | ⛔ | Caso de uso obvio: "pedí aprobación humana" |
| F8 | HTTP node sin auth (Bearer/API key/OAuth) | ⛔ | 90% de las APIs externas requieren auth |
| F9 | HTTP node sin body builder visual | ⚠️ | Editar JSON a mano es propenso a errores |
| F10 | Notify node no integra con nada | ⛔ | El nodo existe pero no manda nada |
| F11 | Sin templates de flow | ⚠️ | Onboarding es una pantalla en blanco |
| F12 | Sin versioning de flow | ⚠️ | Romper un flow en producción es irreversible |
| F13 | Sin debugger (step-through, breakpoints, ver variables) | ⛔ | Imposible debuggear flows complejos |
| F14 | Logs sin streaming (polling) | ⚠️ | Los runs largos no se pueden ver en vivo |
| F15 | Sin variables panel (typed inputs) | ⛔ | Hoy las variables salen del aire |
| F16 | Sin schema validation entre nodos | ⚠️ | Errores de tipo en runtime |
| F17 | Sin notas/comentarios en el canvas | 💡 | Crítico cuando el flow crece |
| F18 | Sin tests del flow | ⚠️ | Sin esto, regresiones silenciosas |
| F19 | Sin dispatcher async (todo corre en el handler de la API) | ⛔ | Flows largos timeout-ean en serverless |

### 3.3 Channels (página actualmente vacía)

| # | Gap | Severidad |
|---|---|:-:|
| C1 | Sin Web Widget (embed.js, customización, preview) | ⛔ |
| C2 | Sin WhatsApp (Twilio o Meta Cloud API) | ⛔ |
| C3 | Sin Telegram bot setup | ⚠️ |
| C4 | Sin Slack app (instalación, eventos, slash commands) | ⚠️ |
| C5 | Sin Email inbound + outbound (forward, parse, route) | ⚠️ |
| C6 | Sin Voice / call (Twilio) | 💡 |
| C7 | Sin SMS | 💡 |
| C8 | Sin SDK (npm package) | ⚠️ |
| C9 | Sin webhook entrante genérico | ⛔ |

### 3.4 Conversations Hub

| # | Gap | Severidad |
|---|---|:-:|
| CH1 | Sin detail view (transcript completo) | ⛔ |
| CH2 | Sin search/filter (por canal, agente, status, fecha, tag) | ⛔ |
| CH3 | Sin take-over humano (intervenir en vivo) | ⚠️ |
| CH4 | Sin tags/labels | ⚠️ |
| CH5 | Sin reply manual desde la UI | ⚠️ |
| CH6 | Sin export (CSV, JSON) | ⚠️ |
| CH7 | Sin métricas por agente (CSAT, deflection rate, resolution time) | ⚠️ |
| CH8 | Sin handoff entre agentes (escalado) | ⚠️ |

### 3.5 Producción / Infraestructura

| # | Gap | Severidad |
|---|---|:-:|
| P1 | RBAC sin enforcement | ⛔ Cualquier miembro puede hacer todo |
| P2 | Sin audit log | ⛔ |
| P3 | Sin rate limiting | ⛔ Vector de DoS y de abuso |
| P4 | Sin error tracking (Sentry) | ⛔ |
| P5 | Sin product analytics (PostHog) | ⚠️ |
| P6 | Sin usage tracking para billing | ⛔ |
| P7 | Sin Stripe / billing flow | ⛔ |
| P8 | Sin plan tiers + quotas | ⛔ |
| P9 | Sin email transaccional (Resend/Postmark) | ⛔ welcome, invites, reset |
| P10 | Sin invite flow para workspace | ⛔ |
| P11 | `requireEmailVerification: false` | ⛔ |
| P12 | Sin password reset UI | ⛔ |
| P13 | Sin 2FA | ⚠️ |
| P14 | Sin session management UI | ⚠️ |
| P15 | Sin API pública + API keys reales | ⛔ |
| P16 | Sin webhook outbound system (eventos para terceros) | ⚠️ |
| P17 | Sin GDPR data export / deletion | ⛔ |
| P18 | Sin backups documentados | ⛔ |
| P19 | Sin health check / status endpoint | ⚠️ |
| P20 | Sin CI/CD (no veo GitHub Actions) | ⚠️ |
| P21 | Sin staging env documentado | ⚠️ |
| P22 | Sin sandbox / queue para flow execution (corre en handler) | ⛔ |
| P23 | Sin row-level isolation tests | ⚠️ |

### 3.6 Frontend / UX

| # | Gap | Severidad |
|---|---|:-:|
| U1 | Sin toast system | ⛔ Errores como `alert()` son inaceptables |
| U2 | `confirm()` browser nativo | ⛔ |
| U3 | Sin skeleton loaders (sólo spinners) | ⚠️ |
| U4 | Sin error boundaries de React | ⚠️ |
| U5 | Sin 404/500 pages custom | ⚠️ |
| U6 | Sin mobile responsive (Studio, Flow Builder, Organigrama) | ⛔ |
| U7 | Sin command palette (Cmd-K) | ⚠️ |
| U8 | Sin global search | ⚠️ |
| U9 | Sin help/docs in-app | ⚠️ |
| U10 | Empty states sin CTAs reales | ⚠️ |
| U11 | Sin profile page del usuario | ⚠️ |
| U12 | Theme toggle existe pero no testeado | 💡 |
| U13 | Sin breadcrumbs | 💡 |
| U14 | i18n sólo parcial (muchos hardcoded strings) | ⚠️ |
| U15 | Sin shortcuts en Flow Builder | ⚠️ |
| U16 | Sin undo/redo en Flow Builder | ⚠️ |
| U17 | Sin auto-save (todo es manual) | ⚠️ |
| U18 | Sin preview de embed code para web widget | ⛔ |

### 3.7 Marketing / Adopción

| # | Gap | Severidad |
|---|---|:-:|
| M1 | Sin landing pública | ⛔ |
| M2 | Sin pricing page | ⛔ |
| M3 | Sin docs externos (docs.orchester.io) | ⚠️ |
| M4 | Sin demo workspace pre-cargado | ⚠️ |
| M5 | Sin templates marketplace | ⚠️ |
| M6 | Sin video demo | ⚠️ |
| M7 | Sin status page | 💡 |
| M8 | Sin changelog | 💡 |
| M9 | Sin programa de referidos | 💡 |

### 3.8 Legal / Compliance

| # | Gap | Severidad |
|---|---|:-:|
| L1 | Sin Privacy Policy | ⛔ |
| L2 | Sin Terms of Service | ⛔ |
| L3 | Sin Cookie banner | ⚠️ (GDPR/CCPA) |
| L4 | Sin DPA template | ⚠️ |
| L5 | Sin SOC2 roadmap | 💡 (B2B requiere) |

---

## 4. Principios de producto (qué decisiones nos guían)

Antes del roadmap, fijamos 6 principios — cuando haya duda, estos mandan:

1. **Power user first** — tooling profundo (debugger, code node, custom auth) sin sacrificar UX.
2. **Self-serve obligatorio** — cero "contactá a ventas" hasta el plan Enterprise.
3. **Multi-provider de día 0** — nunca atar al usuario a un solo LLM.
4. **Open core** — el motor de flujos y los datos del workspace son del usuario; SDK + API pública desde el lanzamiento.
5. **Observability de día 0** — todo evento queda registrado. El usuario puede auditar y debuggear sin pedirnos logs.
6. **Privacy by default** — encryption at rest, RBAC enforced, GDPR-ready, sin tracking innecesario.

---

## 5. Roadmap de lanzamiento (8 fases, prioridad descendente)

Cada fase entrega valor independiente y deja el sistema en estado releasable.

### **Fase 1 — Agentes completos** (alta prioridad, 1.5–2 semanas)
**Goal:** Resolver el pedido directo del usuario: agente conversacional vs flow-driven, con tools.

**Schema:**
- `agent.kind` enum: `"conversational" | "flow"` (default `conversational`)
- `agent.flowId` text nullable — si `kind="flow"`, apunta al flow que ejecuta
- `agent.tools` jsonb — array de tool IDs habilitados
- `agent.variables` jsonb — `{ key: value }` interpoladas en el prompt
- `agent.greeting`, `agent.fallback`, `agent.starters` text/jsonb
- `agent.avatarUrl`, `agent.color` text
- `agent.maxTurns` integer (default 20)
- `agent.responseFormat` enum `"text" | "json" | "markdown"`
- `agent.outputSchema` jsonb (JSON schema) — sólo si `responseFormat=json`
- Nueva tabla `agent_tool` (workspaceId, name, kind, config jsonb) — tools custom
- Nueva tabla `agent_eval` (agentId, name, input, expectedOutput, lastResult)

**Tools built-in (primer batch):**
- `http_request` — wrapper genérico con auth
- `web_search` — Tavily o Brave API
- `calculator` — eval seguro de expresiones
- `current_time` — devuelve fecha/hora workspace timezone
- `knowledge_search` — RAG (Fase 3)
- `flow_call` — invocar otro flow desde el agente

**UI:**
- Agent Studio recibe nuevo tab "Configuración" con: kind selector, flowId picker (si flow), tools multi-select, variables editor (JSON), greeting/fallback/starters, avatar uploader, response format
- Si `kind=flow`, el panel de prompt editor se oculta y se muestra "Este agente se ejecuta con el flujo X — editar →"
- Inspector del Flow Builder ya soporta agent picker; agregar override de variables

**Acceptance:**
- [ ] Crear agente conversacional con 3 tools, mandar mensaje y ver tool calls en el transcript
- [ ] Crear agente tipo `flow`, click run-test → ejecuta el flow vinculado
- [ ] Output schema JSON validado, agente responde JSON estructurado

---

### **Fase 2 — Flow Builder profesional** (alta prioridad, 2.5–3 semanas)
**Goal:** Que el flow builder sea competitivo con n8n / Make / Zapier para casos AI-first.

**Triggers nuevos:**
- `webhook` — URL pública (con secret HMAC) que dispara el flow
- `schedule` — cron expression
- `conversation_event` — `message_received`, `conversation_started`, `escalated`
- `email` — inbox virtual `flow-{id}@inbound.orchester.io` (Postmark/Resend)
- `form` — formulario público generado

**Nodos nuevos:**
- `loop_for_each` — itera array, ejecuta sub-canvas por elemento
- `parallel` — ejecuta hijos en paralelo, sigue cuando todos terminan
- `try_catch` — wrap de un sub-canvas con fallback en error
- `code` — JS expression con sandbox vm2, acceso a `vars`
- `subflow` — invoca otro flow del workspace
- `wait_human` — pausa hasta que un humano apruebe (UI + email + Slack)
- `db_read` / `db_write` — query/upsert en una tabla "data store" del workspace
- `slack_send` — manda mensaje a canal Slack (requiere integración Fase 4)
- `email_send` — manda email transaccional
- `webhook_out` — POST a URL externa con retry/backoff
- `condition_switch` — multi-branch (más de true/false)

**HTTP node mejorado:**
- Auth: None / Bearer / Basic / API Key (header o query) / OAuth2
- Body builder visual (form-data, x-www-form, JSON tree editor)
- Retry: maxAttempts, backoff strategy
- Timeout configurable

**Builder UX:**
- Variables panel lateral con tipos (`string | number | bool | object | array`) y defaults
- Visual debugger: botón "Run with input" → step-by-step con highlight del nodo actual + view de variables en cada paso
- Undo/redo (Cmd-Z)
- Notas/comentarios sticky en el canvas
- Auto-layout (dagre)
- Auto-save cada 10s
- Versioning: guardar versión, comparar diff, rollback
- Templates library (10+ templates: lead routing, support tier-1, content generation, daily report, etc.)
- Keyboard shortcuts (Delete = remove, Cmd-D = duplicate, Cmd-Z = undo)

**Engine:**
- Mover ejecución a queue (BullMQ + Redis) — dispatcher async
- Streaming de runs (Server-Sent Events) → panel de runs en vivo
- Metrics por step (latencia, tokens, errors)
- Schema typing entre nodos (TypeScript-style validation)

**Acceptance:**
- [ ] Crear flow con webhook trigger, hacer POST → ejecuta y devuelve respuesta
- [ ] Schedule cron `*/5 * * * *` corre cada 5 min
- [ ] try-catch captura un HTTP fail y manda email
- [ ] Visual debugger muestra valores de variables en cada paso
- [ ] Flow con 50 nodos se guarda y ejecuta sin timeout

---

### **Fase 3 — Knowledge & Memory** (alta prioridad, 1.5–2 semanas)
**Goal:** Que los agentes "sepan" del negocio del usuario.

**Schema:**
- Nueva tabla `knowledge_base` (workspaceId, name, embeddingModel, chunkSize)
- Nueva tabla `knowledge_doc` (kbId, title, source, status, content)
- Nueva tabla `knowledge_chunk` (docId, text, embedding vector(1536), metadata jsonb)
- Nueva tabla `agent_memory` (agentId, conversationId, employeeId, memoryJsonb, updatedAt) — memoria larga
- Nueva extensión Postgres `pgvector` (o Pinecone si serverless)

**Features:**
- Upload de documentos (PDF, DOCX, MD, TXT, URL)
- Pipeline de ingesta: parse → chunk → embed → store
- Tool `knowledge_search` que consulta el KB del agente
- Memoria por agente: "el agente recuerda que el cliente prefiere comunicación en inglés"
- Citaciones — el agente devuelve `[chunk:id]` y el frontend lo resuelve a links

**UI:**
- Nueva sección en Agent Studio: "Conocimiento" — multi-select de KBs
- Nueva página `/knowledge` — gestión de bases de conocimiento, drag-drop de archivos, status (parsing/embedding/ready)
- En el TestChat, mostrar citaciones cuando aparecen

**Acceptance:**
- [ ] Subir un PDF de 50 páginas → indexa en < 30s
- [ ] Agente responde con citas correctas a [chunk]
- [ ] Memoria persiste entre conversaciones

---

### **Fase 4 — Channels reales** (crítico para go-to-market, 2–3 semanas)
**Goal:** Que un cliente pueda *realmente* publicar un agente.

**Web Widget (la pantalla de embed):**
- Nuevo subdominio `widget.orchester.io` sirviendo `embed.js`
- Snippet de instalación en `/channels/[id]/install`
- Customización: colores, posición, idioma, avatar, mensajes default
- Open API: `window.Orchester.open()`, `.identify(user)`, `.track(event)`
- Iframe responsive con persistencia de sesión

**WhatsApp:**
- Twilio adapter primero (más simple), Meta Cloud API después
- Setup: pedir API key Twilio + número
- Inbound: webhook → conversation → agente responde → outbound message
- Soporte de templates (HSM) para el primer mensaje de re-engagement

**Telegram:**
- Setup con bot token de @BotFather
- Polling o webhook
- Soporte inline keyboards para botones del agente

**Slack:**
- Slack app marketplace listing
- OAuth install + workspace mapping
- Eventos: `app_mention`, DM, slash commands `/orchester`
- Bloque kit para outputs ricos

**Email:**
- Inbox virtual `flow-{id}@inbound.orchester.io` (Postmark routing rules)
- Outbound vía Postmark (templates con MJML)

**Webhook genérico:**
- POST a `/api/channels/webhook/[secret]` — payload arbitrario, dispara flow

**Schema:**
- Refactor `channel`: kind enum más amplio, config jsonb por canal
- Nueva tabla `integration_credential` (workspaceId, kind, encryptedToken, scope, expiresAt)
- Nueva tabla `webhook_secret` (channelId, secret, kind, lastUsedAt)

**Acceptance:**
- [ ] Pegar embed snippet en una landing → widget aparece, manda mensaje, recibe respuesta del agente
- [ ] Conectar WhatsApp con Twilio → mandar mensaje al número → agente responde
- [ ] Slash command `/orchester ask {question}` en Slack devuelve respuesta inline

---

### **Fase 5 — Conversations Hub completo** (crítico, 1.5 semanas)
**Goal:** El operador humano puede ver, intervenir y mejorar.

**Schema:**
- `conversation.tags` jsonb (array)
- `conversation.csat` integer (1–5)
- `conversation.deflected` boolean (auto-cerrada sin escalar)
- `conversation.assignedToUserId` — para takeover
- Nueva tabla `conversation_label` (workspaceId, name, color)

**UI:**
- Detail drawer con transcript completo + metadata (channel, agent, employee, duración, tokens)
- Filter bar: status, channel, agent, employee, date range, tag, search texto
- Bulk actions: cerrar, asignar, etiquetar, exportar
- Take-over: botón "Pausar agente" → operator escribe → agente vuelve cuando dice "/release"
- Reply manual desde la UI
- CSAT survey al cerrar
- Métricas por agente: deflection rate, avg resolution time, CSAT promedio
- Export CSV/JSON

**Acceptance:**
- [ ] Filtrar 1000 convos por agent + tag → < 200ms
- [ ] Hacer takeover → mensaje del operador llega al canal
- [ ] Export 10000 convos a CSV

---

### **Fase 6 — Producción ready** (no negociable, 2 semanas)
**Goal:** Sistema robusto, seguro, observable.

**RBAC:**
- 4 roles: `owner`, `admin`, `editor`, `viewer`
- Matriz de permisos por recurso (agente, flow, channel, settings)
- Middleware `requirePermission(action, resource)` en cada API route
- UI: settings → miembros → cambiar rol

**Audit log:**
- Nueva tabla `audit_log` (workspaceId, userId, action, resource, resourceId, before, after, ip, userAgent, createdAt)
- Hook automático en endpoints write
- Página `/settings/audit` con filter + export

**Rate limiting:**
- Upstash Redis o in-memory (single node)
- Por usuario/workspace: 100 req/min default, 1000/min para Pro
- 429 con `Retry-After` header

**Error tracking:**
- Sentry SDK (server + client)
- Source maps en Next.js build
- Performance monitoring opcional

**Email transaccional:**
- Resend (más simple) o Postmark
- Templates: welcome, verify-email, reset-password, invite, run-failed, weekly-digest

**Auth UI completa:**
- Password reset flow (request → email → confirm)
- Email verification (al signup)
- 2FA (TOTP — better-auth lo soporta)
- Session management view ("dispositivos conectados")

**Workspace invites:**
- Nueva tabla `workspace_invite` (email, role, token, expiresAt)
- Email con link único
- Aceptar invite crea/asocia user

**API pública + API keys:**
- Nueva tabla `api_key` (workspaceId, name, hashedKey, scopes, lastUsedAt, revokedAt)
- Endpoints públicos en `/api/v1/*` con auth via `Authorization: Bearer ok_...`
- Documentación OpenAPI generada
- SDK npm (`@orchester/sdk`) tipado

**Webhooks outbound:**
- Nueva tabla `webhook` (workspaceId, url, secret, events[])
- Eventos: `agent.responded`, `flow.run.succeeded`, `flow.run.failed`, `conversation.escalated`
- HMAC signature, retry, dead-letter

**Async execution:**
- BullMQ + Redis (o pg-boss)
- Flow executions van a queue, worker separado las procesa
- Workers escalables (Railway/Fly.io workers)

**Acceptance:**
- [ ] Viewer no puede crear agente (403)
- [ ] Audit log captura cada cambio
- [ ] Endpoint público con API key funciona
- [ ] Worker procesa 100 runs/s sin timeout

---

### **Fase 7 — Billing & Plans** (necesario para cobrar, 1.5 semanas)
**Goal:** Self-serve checkout y enforcement de quotas.

**Schema:**
- `workspace.plan` enum (`free`, `starter`, `pro`, `business`, `enterprise`)
- `workspace.stripeCustomerId`, `workspace.stripeSubscriptionId`
- Nueva tabla `usage_event` (workspaceId, kind, amount, costUsd, ts)
- Kind: `agent_message`, `flow_run`, `tokens_in`, `tokens_out`, `kb_query`, `webhook_call`

**Plans:**
| Plan | Precio | Workspaces | Agentes | Flows | Conv./mes | Tokens/mes | Usuarios |
|---|---|---|---|---|---|---|---|
| Free | $0 | 1 | 3 | 3 | 100 | 50K | 1 |
| Starter | $29 | 1 | 10 | 10 | 1K | 500K | 3 |
| Pro | $99 | 3 | 50 | 50 | 10K | 5M | 10 |
| Business | $399 | 10 | ∞ | ∞ | 100K | 50M | 50 |
| Enterprise | Custom | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |

**Features:**
- Stripe Checkout + Customer Portal embebido
- Usage metering en cada API call (llm-call, flow-engine, providers/test)
- Quota enforcement: 80% → warning toast, 100% → block + upgrade CTA
- Página `/settings/billing` con plan actual, uso del mes, historial de invoices
- Webhook Stripe → actualizar `workspace.plan`

**Acceptance:**
- [ ] Upgrade Free → Pro vía Checkout
- [ ] Al pasar 80% de tokens, banner amarillo
- [ ] Al pasar 100%, request bloqueado con CTA

---

### **Fase 8 — Frontend polish + Marketing site** (release blocker, 1.5 semanas)
**Goal:** Producto que se ve y se siente vendible.

**Frontend polish:**
- Toast system con `sonner`
- Confirmation dialogs custom (no `confirm()`)
- Skeleton loaders en todas las listas
- Error boundaries
- 404 / 500 / offline pages
- Mobile responsive: organigrama swipeable, studio collapsable, flow builder con modo "vista" mobile (sin edición)
- Command palette `cmdk` (Cmd-K) — buscar agentes, flows, conversaciones, settings
- Profile page del usuario
- Help center embebido (Markdoc o MDX)
- i18n completo: scan de strings hardcoded y reemplazar con `t()`
- Empty states con ilustraciones + CTA accionable

**Onboarding:**
- Tour interactivo (intro.js o react-joyride) post-signup
- Demo workspace pre-cargado opcional
- Checklist de primeros pasos en el dashboard (1. Conectar provider, 2. Crear primer agente, 3. Pegar widget en tu sitio, 4. Mandar mensaje de prueba)

**Landing pública (Next.js separada o subdominio):**
- Hero con video/mockup
- Pricing transparente
- Social proof / testimonials
- Comparison vs competidores (Voiceflow, Botpress, Stack AI)
- CTA: "Probá gratis" → signup
- Blog con MDX
- Docs externos (Mintlify o Docusaurus)

**Legal:**
- Privacy Policy generada (Termly o redactada)
- Terms of Service
- Cookie banner (con opt-in)
- DPA template descargable

**Acceptance:**
- [ ] Mobile: usar el dashboard sin scroll horizontal
- [ ] Cmd-K funciona en cualquier página
- [ ] Toast aparece cuando se guarda un agente
- [ ] Landing.orchester.io vive y convierte

---

## 6. Cronograma agregado y dependencias

```
Fase 1 (Agentes)          ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 1.5–2 sem
Fase 2 (Flow Builder)         ███████████████░░░░░░░░░░░░░░░░░░░░░░ 2.5–3 sem  (depende F1: tools)
Fase 3 (Knowledge)               ██████████░░░░░░░░░░░░░░░░░░░░░░░░ 1.5–2 sem  (depende F1: tools)
Fase 4 (Channels)                    █████████████████░░░░░░░░░░░░░ 2–3 sem    (depende F1, F2)
Fase 5 (Conversations)                  ████████░░░░░░░░░░░░░░░░░░░ 1.5 sem    (depende F4)
Fase 6 (Producción)                          ██████████░░░░░░░░░░░░ 2 sem      (paralelo con F4–F5)
Fase 7 (Billing)                                ████████░░░░░░░░░░░ 1.5 sem    (depende F6)
Fase 8 (Polish + Mktg)                              ████████░░░░░░░ 1.5 sem    (paralelo con F7)
                                                              ▲
                                                              └─ Launch público
```

**Total estimado:** **12–16 semanas** (3–4 meses) para un producto vendible con tier free/starter/pro.

---

## 7. Quick wins (esta semana, alto impacto / bajo esfuerzo)

Mientras se diseña Fase 1, hay 8 cosas que se pueden hacer **ya** para mejorar la sensación del producto:

1. **Sonner toasts** + reemplazar todos los `alert()` (1 día)
2. **Confirmation dialogs custom** con shadcn (medio día)
3. **Skeleton loaders** en agents, flows, conversations (medio día)
4. **Eliminar página `/usage` mock** o cargarla con datos reales (1 hora)
5. **Limpiar página `/integrations` mock** o populate con un placeholder real (1 hora)
6. **Agregar /api/health endpoint** (10 min)
7. **Sentry SDK** (server + client) en 3 horas con DSN — ya empieza a tracker errores
8. **GitHub Actions CI**: tsc + vitest + build en cada PR (1 hora)

---

## 8. Riesgos y supuestos

| Riesgo | Mitigación |
|---|---|
| Los flows largos timeout-ean en serverless de Vercel | Workers separados (Railway/Fly), queue (BullMQ) — Fase 6 |
| pgvector vs Pinecone — costo + lock-in | Empezar con pgvector (gratis, en mismo Postgres). Migrar si saturamos. |
| Costo de Anthropic/OpenAI en Free tier puede explotar | Quotas duras (Fase 7) + alertas a 80% |
| Soporte de WhatsApp lleva semanas (Meta verification) | Empezar con Twilio (instantáneo), migrar después |
| RBAC mal diseñado fuerza refactor masivo después | Definir matriz upfront en Fase 6, validar con clientes piloto |
| Schema breaking changes después del launch | Drizzle migrations + feature flags para rollouts graduales |

---

## 9. Out of scope (v3+, post-lanzamiento)

- App mobile nativa
- Voz (TTS/STT, llamadas Twilio)
- Templates marketplace público (con revenue share)
- White-label completo (custom domain, custom CSS)
- SSO empresarial (SAML, OIDC, SCIM)
- On-prem / self-hosted
- Co-piloto del agente (sugerencias en tiempo real al operador)
- Compliance heavy (SOC2 Type II, HIPAA, ISO 27001)

---

## 10. Recomendación inmediata

Sugiero arrancar **esta misma semana** con dos pistas en paralelo:

**Pista A — Quick wins** (1–2 días)
Ataca los 8 quick wins arriba. Mejora drásticamente la percepción del producto sin tocar arquitectura.

**Pista B — Fase 1 (Agentes completos)**
La que el usuario pidió explícitamente. Sin esto, ninguna otra fase tiene sentido.

Una vez que Fase 1 está mergeada y testeada con un usuario real (yo o vos), arrancamos Fase 2 + Fase 6 en paralelo (front + back), y desde ahí el camino al lanzamiento es mecánico.

**Mi propuesta:** dividir Fase 1 en sub-tareas tipo el master plan anterior y empezar con los subagentes hoy mismo.
