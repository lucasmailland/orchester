/**
 * Contenido de la documentación pública. Modelo tipado simple (sin MDX) para
 * no agregar dependencias: cada doc es una lista de bloques renderizables.
 *
 * Mantener el contenido REAL y accionable — refleja features que existen.
 */

export type DocBlock =
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "callout"; tone: "info" | "warn"; text: string };

export interface Doc {
  slug: string;
  title: string;
  description: string;
  blocks: DocBlock[];
}

export const DOCS: Doc[] = [
  {
    slug: "introduction",
    title: "Introducción",
    description: "Qué es Orchester y para qué sirve.",
    blocks: [
      { kind: "p", text: "Orchester es una plataforma multi-tenant para construir, conectar y desplegar agentes de IA. Cada workspace tiene sus agentes, canales, flujos, conocimiento (RAG) y métricas de costo." },
      { kind: "h2", text: "Conceptos clave" },
      { kind: "ul", items: [
        "Agente: una entidad con prompt, modelo, herramientas y guard-rails. Puede ser conversacional o flow-driven.",
        "Canal: el punto de entrada (web widget, WhatsApp, Telegram, Slack, email, API).",
        "Flujo: un grafo visual de triggers, condiciones y acciones.",
        "Conocimiento: bases vectoriales (pgvector) que los agentes consultan vía RAG.",
        "Empleado: un usuario interno con budget mensual opcional.",
      ] },
      { kind: "callout", tone: "info", text: "Bring-your-own-key: configurás tus claves de Anthropic, OpenAI, Google o Azure en Ajustes. Orchester nunca usa claves compartidas." },
    ],
  },
  {
    slug: "quickstart",
    title: "Quickstart",
    description: "De cero a tu primer agente respondiendo en 5 minutos.",
    blocks: [
      { kind: "h2", text: "1. Creá tu cuenta" },
      { kind: "p", text: "Registrate con email o Google. El wizard de onboarding crea tu workspace, te pide tu API key del proveedor y te deja elegir un template." },
      { kind: "h2", text: "2. Configurá un proveedor" },
      { kind: "p", text: "En Ajustes → Proveedores IA, pegá tu API key. Se encripta at-rest antes de guardarse." },
      { kind: "h2", text: "3. Creá un agente" },
      { kind: "p", text: "Definí nombre, rol, system prompt y modelo. Probalo en el Test Chat del studio con streaming token-por-token." },
      { kind: "h2", text: "4. Conectá un canal" },
      { kind: "code", lang: "bash", code: `curl -X POST https://tu-instancia/api/channels \\
  -H "content-type: application/json" \\
  -d '{"type":"telegram","name":"Soporte","token":"$BOT_TOKEN"}'` },
      { kind: "p", text: "El webhook inbound queda en /api/channels/{secret}/webhook. Asignale el agente y listo." },
    ],
  },
  {
    slug: "agents",
    title: "Agentes",
    description: "Conversacionales, flow-driven, herramientas y handoff.",
    blocks: [
      { kind: "h2", text: "Tipos" },
      { kind: "ul", items: [
        "Conversacional: loop LLM con herramientas. Mantiene historia compactada y memoria inyectada al system prompt.",
        "Flow-driven: cada mensaje dispara un flujo determinístico.",
      ] },
      { kind: "h2", text: "Herramientas" },
      { kind: "p", text: "Cada agente declara qué tools puede usar. Incluye http_request, knowledge_search, agent_handoff y agent_team_list para trabajo en equipo." },
      { kind: "h2", text: "Handoff entre agentes" },
      { kind: "p", text: "Un agente puede pasar la conversación a otro con agent_handoff. El router recarga prompt/tools/memoria del nuevo agente. Hay protección anti ping-pong (máx 2 handoffs por run)." },
      { kind: "callout", tone: "warn", text: "Si configurás maxTurns muy bajo, el agente puede cortar antes de terminar un razonamiento con tools. El default es 10." },
    ],
  },
  {
    slug: "channels",
    title: "Canales",
    description: "Web widget, WhatsApp, Telegram, Slack, email, API.",
    blocks: [
      { kind: "p", text: "Un canal enruta mensajes inbound a un agente y persiste la conversación. Las credenciales se guardan encriptadas." },
      { kind: "h2", text: "Web Widget" },
      { kind: "p", text: "Embebé el snippet en tu sitio. Soporta branding, saludo y posición configurables." },
      { kind: "h2", text: "Mensajería" },
      { kind: "ul", items: [
        "Telegram: bot token vía BotFather.",
        "WhatsApp: número y token de tu proveedor BSP.",
        "Slack: app con permisos de mensajería.",
        "Email: inbound parsing por dirección dedicada.",
      ] },
      { kind: "h2", text: "Take-over humano" },
      { kind: "p", text: "Un operador puede tomar una conversación; mientras esté tomada, el agente NO auto-responde." },
    ],
  },
  {
    slug: "costs-and-budgets",
    title: "Costos y budgets",
    description: "Tracking por mensaje, budgets por empleado y alertas.",
    blocks: [
      { kind: "p", text: "Cada mensaje del agente registra tokens, costo USD y modelo. La conversación acumula total_cost_usd y total_tokens." },
      { kind: "h2", text: "Budget por empleado" },
      { kind: "p", text: "Seteá monthly_budget_usd por empleado en la tabla de Empleados. Cuando se excede el mes calendario, el agente devuelve el fallback sin consumir tokens del proveedor." },
      { kind: "h2", text: "Alertas" },
      { kind: "p", text: "A 70%, 90% y al exceder, se dispara un email al empleado y un webhook (employee.budget.warn70 / warn90 / exceeded). Una sola vez por mes y nivel." },
      { kind: "callout", tone: "info", text: "El breakdown se ve en cada conversación: total, por mensaje (tokens + costo + modelo) y el medidor de budget del empleado." },
    ],
  },
  {
    slug: "api",
    title: "API",
    description: "Endpoints REST para integrar Orchester.",
    blocks: [
      { kind: "h2", text: "Autenticación" },
      { kind: "p", text: "Las rutas internas usan sesión (cookie). Para integraciones server-to-server usá API keys desde Ajustes → Developers." },
      { kind: "h2", text: "Enviar un mensaje" },
      { kind: "code", lang: "bash", code: `curl -X POST https://tu-instancia/api/channels/{secret}/webhook \\
  -H "content-type: application/json" \\
  -d '{"externalId":"user-123","text":"Hola, necesito ayuda"}'` },
      { kind: "h2", text: "Webhooks salientes" },
      { kind: "p", text: "Suscribite a eventos (agent.responded, conversation.escalated, employee.budget.*). Cada entrega va firmada con HMAC-SHA256 en x-orchester-signature y reintenta con backoff exponencial." },
    ],
  },
  {
    slug: "self-hosting",
    title: "Self-hosting",
    description: "Corré Orchester en tu propia infraestructura.",
    blocks: [
      { kind: "h2", text: "Docker Compose" },
      { kind: "code", lang: "bash", code: `git clone https://github.com/orchester-io/orchester
cd orchester
cp .env.example .env   # configurá DATABASE_URL, BETTER_AUTH_SECRET
docker compose up -d` },
      { kind: "h2", text: "Requisitos" },
      { kind: "ul", items: [
        "Postgres 15+ con extensión pgvector.",
        "Node 22+ si corrés sin Docker.",
        "Una clave de proveedor LLM (Anthropic/OpenAI/Google/Azure).",
      ] },
      { kind: "callout", tone: "info", text: "En self-host sin STRIPE_SECRET_KEY, el billing queda desactivado y el uso es sin límites. La UI muestra \"Self-hosted\"." },
      { kind: "h2", text: "Variables clave" },
      { kind: "ul", items: [
        "DATABASE_URL — Postgres connection string.",
        "BETTER_AUTH_SECRET — secreto de sesiones (obligatorio en prod).",
        "RESEND_API_KEY — emails (alertas de budget, invites). Opcional en dev.",
        "STRIPE_SECRET_KEY + STRIPE_PRICE_* — sólo si querés billing.",
      ] },
    ],
  },
];

export function getDoc(slug: string): Doc | undefined {
  return DOCS.find((d) => d.slug === slug);
}
