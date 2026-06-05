import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import type { FlowNodeData, FlowEdgeData } from "@orchester/db";

/**
 * POST /api/flows/seed-real
 *
 * Crea 4 flows funcionales y reutilizables en el workspace activo. Cada flow
 * se diseñó para correr "como está" en cuanto el operador asigne el agente
 * correcto. Los flows son:
 *
 *   1. lead-qualification    → BANT scoring + ruteo a Closer / nurturing
 *   2. it-helpdesk-router    → triage de IT (password / VPN / hardware)
 *   3. hr-benefits-assist    → vacaciones / payroll / beneficios + escalación
 *   4. daily-summary-mail    → reporte diario por email (cron 9am)
 *
 * Idempotente: si ya existen flows con el mismo `name` los **omite** (no
 * sobreescribe; así el operador no pierde su trabajo si ajustó variables).
 *
 * Devuelve `{ created: [...], skipped: [...] }` con los nombres.
 */
export async function POST() {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const db = getDb();

  // Wrap all tenant-scoped DB work in a single tx with the workspace
  // GUC set (the agents lookup AND the flows seed below all hit FORCE
  // RLS tables).
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);

    // Para los flows necesitamos referenciar agentes existentes por rol — los
    // miramos por nombre (el seed los crea con nombres conocidos). Si no
    // existen, el flow se crea igual y el operador completa el agentId.
    const agents = await tx
      .select({ id: schema.agents.id, name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, ctx.workspace.id));

    const byName = new Map(agents.map((a) => [a.name.toLowerCase(), a.id] as const));
    const refAgent = (name: string) => byName.get(name.toLowerCase()) ?? "";

    const flowsSpec: Array<{
      name: string;
      description: string;
      trigger: "manual" | "webhook" | "schedule" | "conversation";
      triggerConfig: Record<string, unknown>;
      variables: Record<string, unknown>;
      nodes: Array<{ id: string } & FlowNodeData>;
      edges: Array<{ id: string } & FlowEdgeData>;
      enabled?: boolean;
    }> = [
      // ───────────────── 1. LEAD QUALIFICATION ─────────────────
      {
        name: "Lead qualification (BANT)",
        description:
          "Recibe un lead por webhook, lo evalúa con BANT con un agente, y según el score lo manda al Closer (>= 70) o a nurturing.",
        trigger: "webhook",
        triggerConfig: { httpMethod: "POST" },
        variables: {
          // Inputs típicos del webhook
          name: "",
          company: "",
          email: "",
          message: "",
        },
        nodes: [
          {
            id: "n_trigger",
            type: "trigger",
            label: "Webhook",
            config: {},
            position: { x: 50, y: 200 },
          },
          {
            id: "n_qualify",
            type: "agent",
            label: "Calificar BANT",
            config: {
              agentId: refAgent("Lead Qualifier"),
              message:
                'Lead recibido:\nNombre: {{name}}\nEmpresa: {{company}}\nEmail: {{email}}\nMensaje: {{message}}\n\nDevolvé SOLO un JSON con: { "score": 0-100, "budget": bool, "authority": bool, "need": bool, "timeline": "days|weeks|months|none", "reason": "breve" }.',
              outputVar: "bantResult",
            },
            position: { x: 280, y: 200 },
          },
          {
            id: "n_extract_score",
            type: "code",
            label: "Parse score",
            config: {
              // Extrae el score del agentResult (que viene como string JSON o texto)
              source:
                "const raw = ctx.bantResult || ''; const m = raw.match(/\\{[\\s\\S]*\\}/); if (!m) return { score: 0 }; try { return JSON.parse(m[0]); } catch { return { score: 0 }; }",
            },
            position: { x: 530, y: 200 },
          },
          {
            id: "n_check_score",
            type: "condition",
            label: "¿Score ≥ 70?",
            config: {
              condition: { variable: "result.score", op: ">=", value: 70 },
            },
            position: { x: 780, y: 200 },
          },
          {
            id: "n_close",
            type: "agent",
            label: "Closer Bot",
            config: {
              agentId: refAgent("Closer Bot"),
              message:
                "Lead caliente {{name}} ({{company}}). Razón BANT: {{result.reason}}. Sugerí 3 next-steps concretos para cerrar.",
              outputVar: "closerOutput",
            },
            position: { x: 1030, y: 100 },
          },
          {
            id: "n_nurture",
            type: "transform",
            label: "Marcar para nurturing",
            config: { target: "outcome", value: "nurturing_queue" },
            position: { x: 1030, y: 300 },
          },
        ],
        edges: [
          { id: "e1", source: "n_trigger", target: "n_qualify" },
          { id: "e2", source: "n_qualify", target: "n_extract_score" },
          { id: "e3", source: "n_extract_score", target: "n_check_score" },
          { id: "e4", source: "n_check_score", sourceHandle: "true", target: "n_close" },
          { id: "e5", source: "n_check_score", sourceHandle: "false", target: "n_nurture" },
        ],
        enabled: false,
      },

      // ───────────────── 2. IT HELPDESK ROUTER ─────────────────
      {
        name: "IT Helpdesk router",
        description:
          "Triage de tickets IT: por keyword routea a Max IT (password/VPN), Asset Bot (hardware) o escala a humano.",
        trigger: "manual",
        triggerConfig: {},
        variables: {
          ticket: "",
          userEmail: "",
        },
        nodes: [
          {
            id: "n_trigger",
            type: "trigger",
            label: "Inicio",
            config: {},
            position: { x: 50, y: 200 },
          },
          {
            id: "n_classify",
            type: "code",
            label: "Clasificar",
            config: {
              source:
                "const t = (ctx.ticket || '').toLowerCase(); if (/(password|contraseña|reset|login)/.test(t)) return 'password'; if (/(vpn|red|wifi|conexion|conexión)/.test(t)) return 'vpn'; if (/(laptop|monitor|teclado|mouse|hardware|equipo)/.test(t)) return 'hardware'; return 'unknown';",
            },
            position: { x: 280, y: 200 },
          },
          {
            id: "n_switch",
            type: "switch",
            label: "Tipo de ticket",
            config: {
              expression: "{{result}}",
              cases: [
                { value: "password", handle: "password" },
                { value: "vpn", handle: "vpn" },
                { value: "hardware", handle: "hardware" },
              ],
            },
            position: { x: 530, y: 200 },
          },
          {
            id: "n_max_it",
            type: "agent",
            label: "Max IT",
            config: {
              agentId: refAgent("Max IT"),
              message:
                "El usuario {{userEmail}} reporta: {{ticket}}\n\nDale instrucciones paso-a-paso para resolverlo.",
              outputVar: "maxItReply",
            },
            position: { x: 800, y: 100 },
          },
          {
            id: "n_asset",
            type: "agent",
            label: "Asset Bot",
            config: {
              agentId: refAgent("Asset Bot"),
              message:
                "Pedido de hardware de {{userEmail}}: {{ticket}}\n\nValidá si el budget está OK y devolvé los próximos pasos.",
              outputVar: "assetReply",
            },
            position: { x: 800, y: 250 },
          },
          {
            id: "n_escalate",
            type: "wait_human",
            label: "Escalar a humano",
            config: { reason: "Ticket no clasificado, requiere revisión manual" },
            position: { x: 800, y: 400 },
          },
        ],
        edges: [
          { id: "e1", source: "n_trigger", target: "n_classify" },
          { id: "e2", source: "n_classify", target: "n_switch" },
          { id: "e3", source: "n_switch", sourceHandle: "password", target: "n_max_it" },
          { id: "e4", source: "n_switch", sourceHandle: "vpn", target: "n_max_it" },
          { id: "e5", source: "n_switch", sourceHandle: "hardware", target: "n_asset" },
          { id: "e6", source: "n_switch", sourceHandle: "default", target: "n_escalate" },
        ],
        enabled: false,
      },

      // ───────────────── 3. HR BENEFITS ASSIST ─────────────────
      {
        name: "HR benefits assistant",
        description:
          "Sofia HR responde la consulta. Si detecta complejidad (mencionado por la propia respuesta), escala a Elena HR Pro.",
        trigger: "conversation",
        triggerConfig: {},
        variables: {
          question: "",
          employeeName: "",
        },
        nodes: [
          {
            id: "n_trigger",
            type: "trigger",
            label: "Mensaje recibido",
            config: {},
            position: { x: 50, y: 200 },
          },
          {
            id: "n_sofia",
            type: "agent",
            label: "Sofia HR (tier 1)",
            config: {
              agentId: refAgent("Sofia HR"),
              message:
                "Empleado {{employeeName}} pregunta: {{question}}\n\nRespondé claro y empático. Si NO podés resolver el caso, comenzá tu respuesta con la palabra ESCALAR seguida del motivo.",
              outputVar: "sofiaReply",
            },
            position: { x: 280, y: 200 },
          },
          {
            id: "n_check_escalate",
            type: "condition",
            label: "¿Escalar?",
            config: {
              condition: { variable: "sofiaReply", op: "starts_with", value: "ESCALAR" },
            },
            position: { x: 530, y: 200 },
          },
          {
            id: "n_elena",
            type: "agent",
            label: "Elena HR Pro",
            config: {
              agentId: refAgent("Elena HR Pro"),
              message:
                "Caso escalado por Sofia para {{employeeName}}.\nPregunta original: {{question}}\nNota de Sofia: {{sofiaReply}}",
              outputVar: "elenaReply",
            },
            position: { x: 800, y: 100 },
          },
          {
            id: "n_done",
            type: "end",
            label: "Listo",
            config: {},
            position: { x: 800, y: 300 },
          },
        ],
        edges: [
          { id: "e1", source: "n_trigger", target: "n_sofia" },
          { id: "e2", source: "n_sofia", target: "n_check_escalate" },
          { id: "e3", source: "n_check_escalate", sourceHandle: "true", target: "n_elena" },
          { id: "e4", source: "n_check_escalate", sourceHandle: "false", target: "n_done" },
        ],
        enabled: false,
      },

      // ───────────────── 4. DAILY SUMMARY MAIL ─────────────────
      {
        name: "Daily summary mail",
        description:
          "Cron diario 09:00. Trae métricas del día desde el dashboard, las resume con un agente, y manda un mail.",
        trigger: "schedule",
        triggerConfig: { cron: "0 9 * * *", tz: "America/Argentina/Buenos_Aires" },
        variables: {
          // Editable por el operador
          recipientEmail: "ops@acme.com",
          appUrl: "{{NEXT_PUBLIC_APP_URL}}",
        },
        nodes: [
          {
            id: "n_trigger",
            type: "trigger",
            label: "Cron 09:00",
            config: {},
            position: { x: 50, y: 200 },
          },
          {
            id: "n_fetch_metrics",
            type: "http",
            label: "GET /api/billing/usage",
            config: {
              method: "GET",
              url: "{{appUrl}}/api/billing/usage",
              outputVar: "usage",
            },
            position: { x: 280, y: 200 },
          },
          {
            id: "n_summarize",
            type: "agent",
            label: "Resumir",
            config: {
              agentId: refAgent("Sofia HR") || refAgent("Alex Welcome"),
              message:
                "Generá un resumen ejecutivo de 4 bullets en español para enviar por mail.\nMétricas:\n{{usage}}\n\nSólo bullets, sin saludos. Tono profesional.",
              outputVar: "summary",
            },
            position: { x: 530, y: 200 },
          },
          {
            id: "n_send",
            type: "http",
            label: "POST email",
            config: {
              method: "POST",
              url: "{{appUrl}}/api/internal/send-mail",
              headers: { "content-type": "application/json" },
              body: '{"to":"{{recipientEmail}}","subject":"Reporte diario Orchester","text":"{{summary}}"}',
              outputVar: "mailResult",
            },
            position: { x: 800, y: 200 },
          },
        ],
        edges: [
          { id: "e1", source: "n_trigger", target: "n_fetch_metrics" },
          { id: "e2", source: "n_fetch_metrics", target: "n_summarize" },
          { id: "e3", source: "n_summarize", target: "n_send" },
        ],
        enabled: false,
      },
    ];

    // Idempotente por nombre.
    const existing = await tx
      .select({ id: schema.flows.id, name: schema.flows.name })
      .from(schema.flows)
      .where(
        and(
          eq(schema.flows.workspaceId, ctx.workspace.id),
          inArray(
            schema.flows.name,
            flowsSpec.map((f) => f.name)
          )
        )
      );
    const existingNames = new Set(existing.map((e) => e.name));

    const created: string[] = [];
    const skipped: string[] = [];
    for (const f of flowsSpec) {
      if (existingNames.has(f.name)) {
        skipped.push(f.name);
        continue;
      }
      await tx.insert(schema.flows).values({
        id: createId(),
        workspaceId: ctx.workspace.id,
        name: f.name,
        description: f.description,
        status: "draft",
        trigger: f.trigger,
        triggerConfig: f.triggerConfig,
        nodes: f.nodes,
        edges: f.edges,
        variables: f.variables,
        enabled: f.enabled ?? false,
      });
      created.push(f.name);
    }

    return NextResponse.json({ created, skipped });
  });
}
