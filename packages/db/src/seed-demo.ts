/**
 * seed-demo.ts — Realistic demo data for Orchester showcase.
 *
 * Populates the FIRST existing workspace with:
 *   - 6 teams (Comercial · Soporte · Marketing · RRHH · Finanzas · Operaciones)
 *   - 16 employees with manager hierarchy → organigrama renders rich
 *   - 14 agents (mix of conversational + flow-driven), real prompts/starters
 *   - 7 flows with multi-node DAGs (kb_search, agent, condition, http, switch, ...)
 *   - 4 knowledge bases with sample docs + chunks
 *   - 4 active channels (web widget, slack, telegram, whatsapp)
 *   - 22 conversations with realistic messages, tokens, costs, CSAT
 *
 * Idempotent: detects prior demo data (looks for "🎯 Comercial" team) and
 * either bails out or — with DEMO_RESET=1 — wipes and re-seeds.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @orchester/db seed:demo
 *   DEMO_RESET=1 DATABASE_URL=... pnpm --filter @orchester/db seed:demo   # wipe + reseed
 */

import { createId } from "@paralleldrive/cuid2";
import { createDbClient } from "./client";
import * as schema from "./schema";
import { eq, inArray, and } from "drizzle-orm";

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const COMERCIAL_TEAM_MARKER = "🎯 Comercial";

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3600 * 1000);
}

function daysAgo(d: number): Date {
  return new Date(Date.now() - d * 86400 * 1000);
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const db = createDbClient(url);

  const [ws] = await db.select().from(schema.workspaces).limit(1);
  if (!ws) {
    console.log("⚠ No workspace yet. Sign up in the app first, then re-run.");
    process.exit(0);
  }
  const wsId = ws.id;
  console.log(`◆ Seeding demo data into workspace: ${ws.name} (${wsId})`);

  // ── Idempotency / reset ────────────────────────────────────────────────
  const existing = await db
    .select()
    .from(schema.teams)
    .where(and(eq(schema.teams.workspaceId, wsId), eq(schema.teams.name, COMERCIAL_TEAM_MARKER)));

  if (existing.length > 0) {
    if (process.env.DEMO_RESET === "1") {
      console.log("⟲ DEMO_RESET=1 — wiping prior demo data…");
      await wipe(db, wsId);
    } else {
      console.log("✓ Demo data already present. Run with DEMO_RESET=1 to wipe and reseed.");
      process.exit(0);
    }
  }

  // ── 1. Teams (6) ───────────────────────────────────────────────────────
  console.log("→ Creating 6 teams (org chart)…");

  const T = {
    comercial: createId(),
    soporte: createId(),
    marketing: createId(),
    rrhh: createId(),
    finanzas: createId(),
    operaciones: createId(),
  };

  await db.insert(schema.teams).values([
    {
      id: T.comercial,
      workspaceId: wsId,
      name: COMERCIAL_TEAM_MARKER,
      description: "Pipeline, calificación de leads, cierre.",
      avatarColor: "#22d3ee",
    },
    {
      id: T.soporte,
      workspaceId: wsId,
      name: "🛟 Soporte",
      description: "Atención al cliente, triage, escalación a humano.",
      avatarColor: "#34d399",
    },
    {
      id: T.marketing,
      workspaceId: wsId,
      name: "📢 Marketing",
      description: "Contenido, campañas, brand voice.",
      avatarColor: "#f472b6",
    },
    {
      id: T.rrhh,
      workspaceId: wsId,
      name: "👥 People Ops",
      description: "Onboarding, políticas, requests internos.",
      avatarColor: "#a78bfa",
    },
    {
      id: T.finanzas,
      workspaceId: wsId,
      name: "💰 Finanzas",
      description: "Gastos, forecast, conciliación.",
      avatarColor: "#fbbf24",
    },
    {
      id: T.operaciones,
      workspaceId: wsId,
      name: "⚙️ Operaciones",
      description: "IT helpdesk, incidentes, automatización interna.",
      avatarColor: "#7c8cff",
    },
  ]);

  // ── 2. Employees (16) — with manager hierarchy ─────────────────────────
  console.log("→ Creating 16 employees with org hierarchy…");

  const E: Record<string, string> = {};
  const emp = (name: string, email: string, area: string, manager?: string) => {
    const id = createId();
    E[email] = id;
    return {
      id,
      workspaceId: wsId,
      name,
      email,
      area,
      managerId: manager ? E[manager] : null,
      active: true,
    };
  };

  // CEO at the top, then VPs per area, then ICs
  await db.insert(schema.employees).values([
    emp("Lucas Mailland", "lucas@orchester.local", "CEO"),
    // Comercial
    emp("Sofía García", "sofia@orchester.local", "VP Comercial", "lucas@orchester.local"),
    emp("Mateo Rodríguez", "mateo@orchester.local", "AE Senior", "sofia@orchester.local"),
    emp("Camila Torres", "camila@orchester.local", "SDR", "sofia@orchester.local"),
    // Soporte
    emp("Diego Fernández", "diego@orchester.local", "Head of Support", "lucas@orchester.local"),
    emp("Lucía Pérez", "lucia@orchester.local", "Support Tier 2", "diego@orchester.local"),
    emp("Tomás Silva", "tomas@orchester.local", "Support Tier 1", "diego@orchester.local"),
    // Marketing
    emp("Valentina López", "valentina@orchester.local", "CMO", "lucas@orchester.local"),
    emp("Joaquín Romero", "joaquin@orchester.local", "Content Lead", "valentina@orchester.local"),
    // RRHH
    emp("Florencia Castro", "florencia@orchester.local", "Head of People", "lucas@orchester.local"),
    emp("Bruno Vega", "bruno@orchester.local", "People Partner", "florencia@orchester.local"),
    // Finanzas
    emp("Martín Ortiz", "martin@orchester.local", "CFO", "lucas@orchester.local"),
    emp("Agustina Méndez", "agustina@orchester.local", "FP&A Analyst", "martin@orchester.local"),
    // Operaciones
    emp("Nicolás Ríos", "nicolas@orchester.local", "Head of Ops", "lucas@orchester.local"),
    emp("Renata Acosta", "renata@orchester.local", "DevOps Engineer", "nicolas@orchester.local"),
    emp("Pablo Mojeda", "pablo@orchester.local", "IT Support", "nicolas@orchester.local"),
  ]);

  // ── 3. Knowledge bases (4) ─────────────────────────────────────────────
  console.log("→ Creating 4 knowledge bases with sample docs…");

  const KB = {
    product: createId(),
    hr: createId(),
    itRunbook: createId(),
    brand: createId(),
  };

  await db.insert(schema.knowledgeBases).values([
    {
      id: KB.product,
      workspaceId: wsId,
      name: "Product Docs",
      description: "Documentación pública del producto — features, API, integraciones.",
    },
    {
      id: KB.hr,
      workspaceId: wsId,
      name: "HR Policies",
      description: "Vacaciones, licencias, beneficios, código de conducta.",
    },
    {
      id: KB.itRunbook,
      workspaceId: wsId,
      name: "IT Runbook",
      description: "Procedimientos internos para incidentes y troubleshooting.",
    },
    {
      id: KB.brand,
      workspaceId: wsId,
      name: "Brand Voice Guide",
      description: "Tono, vocabulario, do's & don'ts para todo content.",
    },
  ]);

  await db.insert(schema.knowledgeDocs).values([
    {
      id: createId(),
      kbId: KB.product,
      workspaceId: wsId,
      title: "Getting Started.md",
      source: "text",
      status: "ready",
      chunkCount: 12,
    },
    {
      id: createId(),
      kbId: KB.product,
      workspaceId: wsId,
      title: "API Reference v1.md",
      source: "text",
      status: "ready",
      chunkCount: 47,
    },
    {
      id: createId(),
      kbId: KB.product,
      workspaceId: wsId,
      title: "Pricing & Plans.md",
      source: "text",
      status: "ready",
      chunkCount: 8,
    },
    {
      id: createId(),
      kbId: KB.hr,
      workspaceId: wsId,
      title: "Política de Vacaciones 2026.pdf",
      source: "upload",
      status: "ready",
      chunkCount: 18,
    },
    {
      id: createId(),
      kbId: KB.hr,
      workspaceId: wsId,
      title: "Código de Conducta.md",
      source: "text",
      status: "ready",
      chunkCount: 22,
    },
    {
      id: createId(),
      kbId: KB.hr,
      workspaceId: wsId,
      title: "Beneficios y Compensación.md",
      source: "text",
      status: "ready",
      chunkCount: 14,
    },
    {
      id: createId(),
      kbId: KB.itRunbook,
      workspaceId: wsId,
      title: "VPN Troubleshooting.md",
      source: "text",
      status: "ready",
      chunkCount: 9,
    },
    {
      id: createId(),
      kbId: KB.itRunbook,
      workspaceId: wsId,
      title: "Postgres Restore Procedure.md",
      source: "text",
      status: "ready",
      chunkCount: 16,
    },
    {
      id: createId(),
      kbId: KB.brand,
      workspaceId: wsId,
      title: "Tone of Voice.md",
      source: "text",
      status: "ready",
      chunkCount: 11,
    },
  ]);

  // ── 4. Agents (14) ─────────────────────────────────────────────────────
  console.log("→ Creating 14 agents (conversational + flow)…");

  const A = {
    leadQualifier: createId(),
    salesCoach: createId(),
    demoScheduler: createId(),
    tier1Support: createId(),
    multilingualSupport: createId(),
    onboardingHelper: createId(),
    contentWriter: createId(),
    newsletterGen: createId(),
    brandVoice: createId(),
    onboardingBuddy: createId(),
    ptoApprover: createId(),
    recruiterScreener: createId(),
    expenseAuditor: createId(),
    itHelpdesk: createId(),
  };

  await db.insert(schema.agents).values([
    // ─ Comercial ─
    {
      id: A.leadQualifier,
      workspaceId: wsId,
      teamId: T.comercial,
      name: "Lead Qualifier",
      role: "Califica leads B2B con BANT",
      kind: "flow",
      status: "active",
      systemPrompt:
        "You are a B2B sales lead qualifier. Evaluate leads using BANT (Budget, Authority, Need, Timeline). Return a structured JSON with: { score: 0-100, bant: { budget, authority, need, timeline }, signals: string[], next_action: string }. Be decisive — if signals are weak, score low and recommend nurturing.",
      model: "claude-sonnet-4-6",
      temperature: "0.3",
      responseFormat: "json",
      color: "#22d3ee",
      starters: [],
    },
    {
      id: A.salesCoach,
      workspaceId: wsId,
      teamId: T.comercial,
      name: "Sales Coach",
      role: "Coach interno para AEs y SDRs",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You are an experienced B2B sales coach. Help Account Executives and SDRs prepare for calls, handle objections, craft follow-ups, and refine outreach. Be specific, reference frameworks (MEDDIC, SPIN, Challenger), and give them words they can actually say. No fluff.",
      model: "claude-sonnet-4-6",
      temperature: "0.7",
      color: "#22d3ee",
      greeting:
        "¡Hola! Soy tu Sales Coach. ¿Querés practicar un pitch, preparar una call, o destrabar una oportunidad?",
      starters: [
        "Tengo una demo en 2 horas con un CTO de fintech, ¿qué pregunto?",
        "El prospecto dijo 'es caro' — ¿cómo respondo?",
        "Ayudame a escribir un follow-up para una call que fue tibia",
        "¿Cómo califico mejor con MEDDIC?",
      ],
    },
    {
      id: A.demoScheduler,
      workspaceId: wsId,
      teamId: T.comercial,
      name: "Demo Scheduler",
      role: "Agenda demos vía webhook de pricing page",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Confirm meeting details from form input, validate slot availability, and respond with confirmation message in the user's language.",
      model: "claude-haiku-4-5",
      temperature: "0.2",
      color: "#22d3ee",
    },

    // ─ Soporte ─
    {
      id: A.tier1Support,
      workspaceId: wsId,
      teamId: T.soporte,
      name: "Tier 1 Support",
      role: "Resuelve dudas con KB · escala lo complejo",
      kind: "flow",
      status: "active",
      systemPrompt:
        "You are Orchester's first-line support. Answer using ONLY the provided context from the knowledge base. If the context doesn't cover the question, say 'voy a derivarte con alguien del equipo' and set escalate=true in your JSON output. Always be friendly and concise. Languages: Spanish + English.",
      model: "claude-sonnet-4-6",
      temperature: "0.3",
      responseFormat: "json",
      color: "#34d399",
    },
    {
      id: A.multilingualSupport,
      workspaceId: wsId,
      teamId: T.soporte,
      name: "Multilingual Support",
      role: "Detecta idioma y responde en cualquiera",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You are a polyglot support agent. Detect the language of each user message and respond in that exact language. Supported: Spanish, English, Portuguese, French, German, Italian. Stay friendly, concise, and accurate. If you don't know an answer, say so honestly.",
      model: "claude-sonnet-4-6",
      temperature: "0.5",
      color: "#34d399",
      greeting: "Hi! Ask me anything in any language and I'll reply in yours.",
      starters: [
        "How do I reset my password?",
        "¿Cómo cancelo mi suscripción?",
        "Como faço para integrar com Slack?",
        "Quelles sont les options de paiement ?",
      ],
    },
    {
      id: A.onboardingHelper,
      workspaceId: wsId,
      teamId: T.soporte,
      name: "Onboarding Helper",
      role: "Guía a nuevos usuarios paso a paso",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You are a friendly onboarding guide for new Orchester users. Walk them through: creating their first agent, connecting an AI provider, building their first flow. Be encouraging, give one step at a time, ask clarifying questions if their goal is unclear. Celebrate small wins.",
      model: "claude-sonnet-4-6",
      temperature: "0.7",
      color: "#34d399",
      greeting: "¡Bienvenido a Orchester! ¿Qué te gustaría construir primero?",
      starters: [
        "Quiero conectar mi clave de OpenAI",
        "Ayudame a crear mi primer agente",
        "¿Qué es un flow y cuándo lo uso?",
        "Tour rápido del producto",
      ],
    },

    // ─ Marketing ─
    {
      id: A.contentWriter,
      workspaceId: wsId,
      teamId: T.marketing,
      name: "Content Writer",
      role: "Blog posts, social copy, landing copy",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You are a senior B2B content writer specialized in dev tools and AI infrastructure. Voice: direct, technical-but-accessible, dry humor occasionally, never hyperbolic. You write for engineers and technical founders. Avoid marketing clichés ('revolutionary', 'game-changing', 'cutting-edge'). When asked for copy, deliver multiple options with different angles.",
      model: "claude-sonnet-4-6",
      temperature: "0.8",
      color: "#f472b6",
      greeting: "Hola, soy tu Content Writer. ¿Qué necesitás escribir hoy?",
      starters: [
        "Escribime un blog post de 800 palabras sobre multi-tenancy en agentes AI",
        "3 títulos para una landing de pricing",
        "Tweet thread sobre cómo manejamos costos de LLM",
        "LinkedIn post anunciando v0.1.0",
      ],
    },
    {
      id: A.newsletterGen,
      workspaceId: wsId,
      teamId: T.marketing,
      name: "Newsletter Generator",
      role: "Compila el newsletter semanal automáticamente",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Compile a weekly newsletter from the inputs: recent product updates, top community discussions, featured customer story, upcoming events. Output: clean markdown with sections, ~600 words, conversational tone, ends with a CTA.",
      model: "claude-sonnet-4-6",
      temperature: "0.6",
      color: "#f472b6",
    },
    {
      id: A.brandVoice,
      workspaceId: wsId,
      teamId: T.marketing,
      name: "Brand Voice Checker",
      role: "Revisa que cualquier copy respete el brand voice",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You are a strict brand voice editor. Given any draft copy, evaluate it against the brand guide (use the KB tool). Return: (1) on-brand score 0-100, (2) specific issues with line references, (3) a corrected version. Be honest — if it's bad, say it's bad.",
      model: "claude-sonnet-4-6",
      temperature: "0.4",
      color: "#f472b6",
      greeting: "Pegame el copy que querés revisar y te lo audito contra el brand voice.",
      starters: [
        "Revisá este blog post",
        "¿Este tweet está on-brand?",
        "Corregí el tono de este email",
      ],
    },

    // ─ RRHH ─
    {
      id: A.onboardingBuddy,
      workspaceId: wsId,
      teamId: T.rrhh,
      name: "Onboarding Buddy",
      role: "Responde preguntas frecuentes de nuevos empleados",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You are a warm, helpful HR onboarding buddy. Answer new hire questions using the HR Policies knowledge base. Topics: PTO, benefits, payroll dates, code of conduct, remote work policy, equipment. If something isn't in the KB, recommend they contact People Ops directly. Always reply in Spanish unless asked otherwise.",
      model: "claude-sonnet-4-6",
      temperature: "0.6",
      color: "#a78bfa",
      greeting: "¡Bienvenide al equipo! Soy tu Onboarding Buddy. Preguntame lo que necesites.",
      starters: [
        "¿Cómo pido vacaciones?",
        "¿Cuándo cobramos?",
        "¿Hay día de home office fijo?",
        "¿Cómo configuro mi equipo de trabajo?",
      ],
    },
    {
      id: A.ptoApprover,
      workspaceId: wsId,
      teamId: T.rrhh,
      name: "PTO Approver",
      role: "Procesa requests de vacaciones automáticamente",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Validate PTO requests against policy. Auto-approve if: <= 5 consecutive days AND > 14 days notice AND balance covers it. Otherwise escalate to manager with summary.",
      model: "claude-haiku-4-5",
      temperature: "0.1",
      responseFormat: "json",
      color: "#a78bfa",
    },
    {
      id: A.recruiterScreener,
      workspaceId: wsId,
      teamId: T.rrhh,
      name: "Recruiter Screener",
      role: "Evalúa CVs contra una JD",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Compare a CV against a job description. Score 0-100 on: hard skills match, years of experience, domain relevance, communication quality (inferred from CV writing). Output JSON with score, top 3 strengths, top 3 gaps, recommendation: { interview | pass | maybe }.",
      model: "claude-sonnet-4-6",
      temperature: "0.3",
      responseFormat: "json",
      color: "#a78bfa",
    },

    // ─ Finanzas ─
    {
      id: A.expenseAuditor,
      workspaceId: wsId,
      teamId: T.finanzas,
      name: "Expense Auditor",
      role: "OCR de recibos + validación contra política",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Given OCR-extracted text from a receipt and an expense policy, output JSON: { amount, currency, vendor, category, policy_violations: string[], approved: boolean, reason: string }. Be strict on violations (over-budget, missing data, blocked categories).",
      model: "claude-sonnet-4-6",
      temperature: "0.2",
      responseFormat: "json",
      color: "#fbbf24",
    },

    // ─ Operaciones ─
    {
      id: A.itHelpdesk,
      workspaceId: wsId,
      teamId: T.operaciones,
      name: "IT Helpdesk",
      role: "Triage y solución de tickets IT",
      kind: "flow",
      status: "active",
      systemPrompt:
        "You are an IT helpdesk agent. Use the IT Runbook KB to answer. For VPN, password, SSO, equipment issues — give step-by-step instructions. For anything that requires admin access, escalate. Always confirm the issue is resolved with a final question.",
      model: "claude-sonnet-4-6",
      temperature: "0.3",
      color: "#7c8cff",
    },
  ]);

  // Assign agents to employees
  await db
    .update(schema.employees)
    .set({ assignedAgentIds: [A.salesCoach] })
    .where(eq(schema.employees.id, E["mateo@orchester.local"]!));

  await db
    .update(schema.employees)
    .set({ assignedAgentIds: [A.salesCoach] })
    .where(eq(schema.employees.id, E["camila@orchester.local"]!));

  await db
    .update(schema.employees)
    .set({ assignedAgentIds: [A.contentWriter, A.brandVoice] })
    .where(eq(schema.employees.id, E["joaquin@orchester.local"]!));

  // ── 5. Flows (7) ───────────────────────────────────────────────────────
  console.log("→ Creating 7 flows with multi-node DAGs…");

  // Flow 1 — Lead qualification + enrichment + routing
  const f1Trigger = createId();
  const f1Http = createId();
  const f1Agent = createId();
  const f1Switch = createId();
  const f1HotPath = createId();
  const f1WarmPath = createId();
  const f1ColdPath = createId();

  await db.insert(schema.flows).values({
    id: createId(),
    workspaceId: wsId,
    name: "🎯 Lead qualification + enrichment + routing",
    description:
      "Webhook desde pricing page → enriquece con Clearbit → BANT scoring → rutea a hot / warm / cold con Slack notify.",
    status: "active",
    trigger: "webhook",
    enabled: true,
    lastRunAt: hoursAgo(3),
    nodes: [
      {
        id: f1Trigger,
        type: "trigger",
        label: "Form submit",
        config: {
          source: "webhook",
          schema: { email: "string", company: "string", role: "string", message: "string" },
        },
        position: { x: 80, y: 200 },
      },
      {
        id: f1Http,
        type: "http",
        label: "Enrich (Clearbit)",
        config: {
          method: "GET",
          url: "https://person.clearbit.com/v2/people/find?email={{trigger.email}}",
          outputVar: "enriched",
        },
        position: { x: 320, y: 200 },
      },
      {
        id: f1Agent,
        type: "agent",
        label: "BANT score",
        config: {
          agentId: A.leadQualifier,
          message: "Lead: {{trigger}}\nEnriched: {{enriched}}",
          outputVar: "score",
        },
        position: { x: 600, y: 200 },
      },
      {
        id: f1Switch,
        type: "switch",
        label: "Route by score",
        config: {
          value: "{{score.score}}",
          cases: [
            { when: ">= 70", label: "hot" },
            { when: ">= 40", label: "warm" },
            { when: "< 40", label: "cold" },
          ],
        },
        position: { x: 880, y: 200 },
      },
      {
        id: f1HotPath,
        type: "notify",
        label: "Slack #hot-leads",
        config: {
          channel: "slack",
          target: "#hot-leads",
          message: "🔥 Hot lead {{trigger.company}} score {{score.score}}",
        },
        position: { x: 1140, y: 100 },
      },
      {
        id: f1WarmPath,
        type: "agent",
        label: "Nurture sequence",
        config: {
          agentId: A.salesCoach,
          message: "Plan a 5-touch nurture for {{trigger}}",
          outputVar: "plan",
        },
        position: { x: 1140, y: 220 },
      },
      {
        id: f1ColdPath,
        type: "end",
        label: "Park in cold list",
        config: {},
        position: { x: 1140, y: 340 },
      },
    ],
    edges: [
      { id: createId(), source: f1Trigger, target: f1Http },
      { id: createId(), source: f1Http, target: f1Agent },
      { id: createId(), source: f1Agent, target: f1Switch },
      { id: createId(), source: f1Switch, target: f1HotPath, sourceHandle: "hot" },
      { id: createId(), source: f1Switch, target: f1WarmPath, sourceHandle: "warm" },
      { id: createId(), source: f1Switch, target: f1ColdPath, sourceHandle: "cold" },
    ],
  });

  // Flow 2 — Support triage with KB and human escalation
  const f2Trigger = createId();
  const f2Kb = createId();
  const f2Agent = createId();
  const f2Cond = createId();
  const f2Resolve = createId();
  const f2Escalate = createId();

  await db.insert(schema.flows).values({
    id: createId(),
    workspaceId: wsId,
    name: "🛟 Support triage (KB → agent → escalate)",
    description:
      "Mensaje del usuario → busca en Product Docs → Tier 1 contesta → si baja confianza, escala a un humano.",
    status: "active",
    trigger: "conversation",
    enabled: true,
    lastRunAt: hoursAgo(1),
    nodes: [
      {
        id: f2Trigger,
        type: "trigger",
        label: "Inbound message",
        config: {},
        position: { x: 80, y: 200 },
      },
      {
        id: f2Kb,
        type: "kb_search",
        label: "Buscar en Product Docs",
        config: { kbId: KB.product, query: "{{message.content}}", topK: 5, outputVar: "context" },
        position: { x: 320, y: 200 },
      },
      {
        id: f2Agent,
        type: "agent",
        label: "Tier 1 responde",
        config: {
          agentId: A.tier1Support,
          message: "Pregunta: {{message.content}}\n\nContexto:\n{{context}}",
          outputVar: "answer",
        },
        position: { x: 600, y: 200 },
      },
      {
        id: f2Cond,
        type: "condition",
        label: "¿Escalar?",
        config: { condition: { left: "{{answer.escalate}}", op: "==", right: "true" } },
        position: { x: 880, y: 200 },
      },
      {
        id: f2Resolve,
        type: "notify",
        label: "Responder al usuario",
        config: { channel: "conversation", message: "{{answer.text}}" },
        position: { x: 1140, y: 280 },
      },
      {
        id: f2Escalate,
        type: "wait_human",
        label: "Asignar a Lucía",
        config: { assigneeEmail: "lucia@orchester.local", note: "Tier 1 no resolvió" },
        position: { x: 1140, y: 120 },
      },
    ],
    edges: [
      { id: createId(), source: f2Trigger, target: f2Kb },
      { id: createId(), source: f2Kb, target: f2Agent },
      { id: createId(), source: f2Agent, target: f2Cond },
      { id: createId(), source: f2Cond, target: f2Escalate, sourceHandle: "true" },
      { id: createId(), source: f2Cond, target: f2Resolve, sourceHandle: "false" },
    ],
  });

  // Flow 3 — Weekly newsletter compile
  const f3Trigger = createId();
  const f3Updates = createId();
  const f3Discussions = createId();
  const f3Compile = createId();
  const f3Image = createId();
  const f3Send = createId();

  await db.insert(schema.flows).values({
    id: createId(),
    workspaceId: wsId,
    name: "📢 Weekly newsletter (Mondays 9am)",
    description:
      "Cron semanal: junta updates de producto + top discussions + genera hero image + manda.",
    status: "active",
    trigger: "schedule",
    triggerConfig: { cron: "0 9 * * MON", timezone: "America/Argentina/Buenos_Aires" },
    enabled: true,
    lastRunAt: daysAgo(2),
    nodes: [
      {
        id: f3Trigger,
        type: "trigger",
        label: "Cron · Lunes 9am",
        config: {},
        position: { x: 80, y: 200 },
      },
      {
        id: f3Updates,
        type: "http",
        label: "Last week's product changes",
        config: {
          method: "GET",
          url: "https://api.github.com/repos/lucasmailland/orchester/commits?since={{lastWeek}}",
          outputVar: "commits",
        },
        position: { x: 340, y: 140 },
      },
      {
        id: f3Discussions,
        type: "http",
        label: "Top Discussions",
        config: {
          method: "GET",
          url: "https://api.github.com/repos/lucasmailland/orchester/discussions?sort=top",
          outputVar: "discussions",
        },
        position: { x: 340, y: 260 },
      },
      {
        id: f3Compile,
        type: "agent",
        label: "Compile newsletter",
        config: {
          agentId: A.newsletterGen,
          message: "Updates: {{commits}}\nTop posts: {{discussions}}",
          outputVar: "newsletter",
        },
        position: { x: 640, y: 200 },
      },
      {
        id: f3Image,
        type: "generate_image",
        label: "Hero image",
        config: {
          provider: "openai",
          model: "dall-e-3",
          prompt: "Header art for: {{newsletter.headline}}, dark cyan + indigo gradient, minimal",
          outputVar: "hero",
        },
        position: { x: 900, y: 140 },
      },
      {
        id: f3Send,
        type: "http",
        label: "POST a Plunk",
        config: {
          method: "POST",
          url: "https://api.useplunk.com/v1/send",
          body: {
            subject: "{{newsletter.subject}}",
            body: "{{newsletter.markdown}}",
            image: "{{hero.url}}",
          },
        },
        position: { x: 1180, y: 200 },
      },
    ],
    edges: [
      { id: createId(), source: f3Trigger, target: f3Updates },
      { id: createId(), source: f3Trigger, target: f3Discussions },
      { id: createId(), source: f3Updates, target: f3Compile },
      { id: createId(), source: f3Discussions, target: f3Compile },
      { id: createId(), source: f3Compile, target: f3Image },
      { id: createId(), source: f3Image, target: f3Send },
    ],
  });

  // Flow 4 — PTO request handler
  const f4Trigger = createId();
  const f4Check = createId();
  const f4Decide = createId();
  const f4Cond = createId();
  const f4Approve = createId();
  const f4Escalate = createId();

  await db.insert(schema.flows).values({
    id: createId(),
    workspaceId: wsId,
    name: "👥 PTO request handler",
    description:
      "Webhook desde el form de vacaciones → chequea balance → auto-aprueba o escala al manager.",
    status: "active",
    trigger: "webhook",
    enabled: true,
    lastRunAt: hoursAgo(20),
    nodes: [
      {
        id: f4Trigger,
        type: "trigger",
        label: "PTO form submit",
        config: {},
        position: { x: 80, y: 200 },
      },
      {
        id: f4Check,
        type: "http",
        label: "Check balance (BambooHR)",
        config: {
          method: "GET",
          url: "https://api.bamboohr.com/v1/employees/{{employee.id}}/time_off",
          outputVar: "balance",
        },
        position: { x: 320, y: 200 },
      },
      {
        id: f4Decide,
        type: "agent",
        label: "Policy check",
        config: {
          agentId: A.ptoApprover,
          message: "Request: {{trigger}}\nBalance: {{balance}}",
          outputVar: "decision",
        },
        position: { x: 580, y: 200 },
      },
      {
        id: f4Cond,
        type: "condition",
        label: "¿Auto-approve?",
        config: { condition: { left: "{{decision.approved}}", op: "==", right: "true" } },
        position: { x: 820, y: 200 },
      },
      {
        id: f4Approve,
        type: "notify",
        label: "Confirmar al empleado",
        config: {
          channel: "email",
          to: "{{trigger.email}}",
          subject: "Vacaciones aprobadas",
          body: "✓ Aprobado {{trigger.from}} → {{trigger.to}}",
        },
        position: { x: 1080, y: 120 },
      },
      {
        id: f4Escalate,
        type: "notify",
        label: "Slack al manager",
        config: {
          channel: "slack",
          target: "{{manager.slack}}",
          message: "PTO request needs review: {{trigger}} — Reason: {{decision.reason}}",
        },
        position: { x: 1080, y: 280 },
      },
    ],
    edges: [
      { id: createId(), source: f4Trigger, target: f4Check },
      { id: createId(), source: f4Check, target: f4Decide },
      { id: createId(), source: f4Decide, target: f4Cond },
      { id: createId(), source: f4Cond, target: f4Approve, sourceHandle: "true" },
      { id: createId(), source: f4Cond, target: f4Escalate, sourceHandle: "false" },
    ],
  });

  // Flow 5 — CV screening pipeline
  const f5Trigger = createId();
  const f5Ocr = createId();
  const f5Screen = createId();
  const f5Cond = createId();
  const f5Interview = createId();
  const f5Reject = createId();

  await db.insert(schema.flows).values({
    id: createId(),
    workspaceId: wsId,
    name: "👥 CV screening pipeline",
    description:
      "Greenhouse webhook → OCR del CV → matchear contra JD → auto-interview o reject con feedback.",
    status: "active",
    trigger: "webhook",
    enabled: true,
    lastRunAt: hoursAgo(6),
    nodes: [
      {
        id: f5Trigger,
        type: "trigger",
        label: "New application",
        config: {},
        position: { x: 80, y: 200 },
      },
      {
        id: f5Ocr,
        type: "ocr_extract",
        label: "OCR del CV (PDF)",
        config: { provider: "mistral", fileUrl: "{{trigger.resume_url}}", outputVar: "cvText" },
        position: { x: 340, y: 200 },
      },
      {
        id: f5Screen,
        type: "agent",
        label: "Score vs JD",
        config: {
          agentId: A.recruiterScreener,
          message: "JD: {{trigger.jd}}\n\nCV:\n{{cvText}}",
          outputVar: "screening",
        },
        position: { x: 620, y: 200 },
      },
      {
        id: f5Cond,
        type: "condition",
        label: "¿Score ≥ 70?",
        config: { condition: { left: "{{screening.score}}", op: ">=", right: "70" } },
        position: { x: 880, y: 200 },
      },
      {
        id: f5Interview,
        type: "http",
        label: "Schedule interview (Cal.com)",
        config: {
          method: "POST",
          url: "https://api.cal.com/bookings",
          body: { candidate: "{{trigger.email}}" },
        },
        position: { x: 1140, y: 120 },
      },
      {
        id: f5Reject,
        type: "notify",
        label: "Polite rejection email",
        config: {
          channel: "email",
          to: "{{trigger.email}}",
          subject: "Update on your application",
          body: "Thanks for applying — {{screening.feedback}}",
        },
        position: { x: 1140, y: 280 },
      },
    ],
    edges: [
      { id: createId(), source: f5Trigger, target: f5Ocr },
      { id: createId(), source: f5Ocr, target: f5Screen },
      { id: createId(), source: f5Screen, target: f5Cond },
      { id: createId(), source: f5Cond, target: f5Interview, sourceHandle: "true" },
      { id: createId(), source: f5Cond, target: f5Reject, sourceHandle: "false" },
    ],
  });

  // Flow 6 — Expense receipt audit
  const f6Trigger = createId();
  const f6Ocr = createId();
  const f6Audit = createId();
  const f6Cond = createId();
  const f6Book = createId();
  const f6Reject = createId();

  await db.insert(schema.flows).values({
    id: createId(),
    workspaceId: wsId,
    name: "💰 Expense receipt audit",
    description:
      "Foto del recibo → OCR → matchear contra política → auto-approve o pedir más datos.",
    status: "active",
    trigger: "webhook",
    enabled: true,
    lastRunAt: hoursAgo(11),
    nodes: [
      {
        id: f6Trigger,
        type: "trigger",
        label: "Receipt uploaded",
        config: {},
        position: { x: 80, y: 200 },
      },
      {
        id: f6Ocr,
        type: "ocr_extract",
        label: "OCR receipt",
        config: { provider: "mistral", fileUrl: "{{trigger.image_url}}", outputVar: "raw" },
        position: { x: 320, y: 200 },
      },
      {
        id: f6Audit,
        type: "agent",
        label: "Policy audit",
        config: {
          agentId: A.expenseAuditor,
          message: "OCR: {{raw}}\nPolicy: max $75/meal, no alcohol, must include vendor",
          outputVar: "audit",
        },
        position: { x: 600, y: 200 },
      },
      {
        id: f6Cond,
        type: "condition",
        label: "¿Approved?",
        config: { condition: { left: "{{audit.approved}}", op: "==", right: "true" } },
        position: { x: 880, y: 200 },
      },
      {
        id: f6Book,
        type: "http",
        label: "Book to NetSuite",
        config: { method: "POST", url: "https://api.netsuite.local/expenses", body: "{{audit}}" },
        position: { x: 1140, y: 120 },
      },
      {
        id: f6Reject,
        type: "notify",
        label: "Pedir aclaración",
        config: {
          channel: "email",
          to: "{{trigger.email}}",
          subject: "Recibo necesita más info",
          body: "{{audit.policy_violations}}",
        },
        position: { x: 1140, y: 280 },
      },
    ],
    edges: [
      { id: createId(), source: f6Trigger, target: f6Ocr },
      { id: createId(), source: f6Ocr, target: f6Audit },
      { id: createId(), source: f6Audit, target: f6Cond },
      { id: createId(), source: f6Cond, target: f6Book, sourceHandle: "true" },
      { id: createId(), source: f6Cond, target: f6Reject, sourceHandle: "false" },
    ],
  });

  // Flow 7 — IT incident triage
  const f7Trigger = createId();
  const f7Kb = createId();
  const f7Agent = createId();
  const f7Cond = createId();
  const f7Solve = createId();
  const f7Escalate = createId();

  await db.insert(schema.flows).values({
    id: createId(),
    workspaceId: wsId,
    name: "⚙️ IT incident triage",
    description:
      "Slack message en #it-help → KB lookup → IT Helpdesk responde → si no resuelve, crea ticket en Linear.",
    status: "active",
    trigger: "webhook",
    enabled: true,
    lastRunAt: hoursAgo(2),
    nodes: [
      {
        id: f7Trigger,
        type: "trigger",
        label: "Slack #it-help message",
        config: {},
        position: { x: 80, y: 200 },
      },
      {
        id: f7Kb,
        type: "kb_search",
        label: "Buscar en IT Runbook",
        config: { kbId: KB.itRunbook, query: "{{trigger.text}}", topK: 3, outputVar: "ctx" },
        position: { x: 320, y: 200 },
      },
      {
        id: f7Agent,
        type: "agent",
        label: "IT Helpdesk responde",
        config: {
          agentId: A.itHelpdesk,
          message: "Issue: {{trigger.text}}\nContext: {{ctx}}",
          outputVar: "response",
        },
        position: { x: 600, y: 200 },
      },
      {
        id: f7Cond,
        type: "condition",
        label: "¿Resuelto?",
        config: { condition: { left: "{{response.resolved}}", op: "==", right: "true" } },
        position: { x: 880, y: 200 },
      },
      {
        id: f7Solve,
        type: "notify",
        label: "Reply in Slack",
        config: {
          channel: "slack",
          target: "{{trigger.channel}}",
          thread_ts: "{{trigger.ts}}",
          message: "{{response.text}}",
        },
        position: { x: 1140, y: 280 },
      },
      {
        id: f7Escalate,
        type: "http",
        label: "Create Linear ticket",
        config: {
          method: "POST",
          url: "https://api.linear.app/graphql",
          body: { title: "{{trigger.text}}", team: "ENG" },
        },
        position: { x: 1140, y: 120 },
      },
    ],
    edges: [
      { id: createId(), source: f7Trigger, target: f7Kb },
      { id: createId(), source: f7Kb, target: f7Agent },
      { id: createId(), source: f7Agent, target: f7Cond },
      { id: createId(), source: f7Cond, target: f7Escalate, sourceHandle: "false" },
      { id: createId(), source: f7Cond, target: f7Solve, sourceHandle: "true" },
    ],
  });

  // ── 6. Channels (5) ────────────────────────────────────────────────────
  console.log("→ Creating 5 channels (web, slack, telegram, whatsapp, api)…");

  const C = {
    web: createId(),
    slack: createId(),
    telegram: createId(),
    whatsapp: createId(),
    api: createId(),
  };

  await db.insert(schema.channels).values([
    {
      id: C.web,
      workspaceId: wsId,
      teamId: T.soporte,
      agentId: A.multilingualSupport,
      name: "Web widget",
      type: "web",
      status: "active",
      secret: "web_" + createId().slice(0, 16),
    },
    {
      id: C.slack,
      workspaceId: wsId,
      teamId: T.operaciones,
      agentId: A.itHelpdesk,
      name: "Slack #it-help",
      type: "slack",
      status: "active",
      secret: "slk_" + createId().slice(0, 16),
    },
    {
      id: C.telegram,
      workspaceId: wsId,
      teamId: T.soporte,
      agentId: A.tier1Support,
      name: "Telegram bot",
      type: "telegram",
      status: "active",
      secret: "tg_" + createId().slice(0, 16),
    },
    {
      id: C.whatsapp,
      workspaceId: wsId,
      teamId: T.comercial,
      agentId: A.demoScheduler,
      name: "WhatsApp Sales",
      type: "whatsapp",
      status: "active",
      secret: "wa_" + createId().slice(0, 16),
    },
    {
      id: C.api,
      workspaceId: wsId,
      teamId: T.comercial,
      name: "Public API key",
      type: "api",
      status: "active",
      secret: "ok_live_" + createId().slice(0, 20),
    },
  ]);

  // ── 7. Conversations (22) with messages ────────────────────────────────
  console.log("→ Creating 22 conversations with realistic message threads…");

  type ConvSpec = {
    agentId: string;
    channelId: string;
    customer: string;
    email: string;
    status: "open" | "closed" | "escalated";
    tags: string[];
    csat?: number;
    hoursAgo: number;
    messages: { role: "user" | "assistant"; content: string; tokens?: number }[];
  };

  const conversations: ConvSpec[] = [
    {
      agentId: A.multilingualSupport,
      channelId: C.web,
      customer: "María Sánchez",
      email: "maria.sanchez@acme.com",
      status: "closed",
      tags: ["password-reset", "auto-resolved"],
      csat: 5,
      hoursAgo: 8,
      messages: [
        { role: "user", content: "Hola, no me llega el mail de recupero de password" },
        {
          role: "assistant",
          content:
            "¡Hola María! Lo más común es que el correo haya caído en spam. ¿Probaste revisar la carpeta de spam o promociones? Si tampoco está ahí, decime el email con el que estás registrada y reenvío manualmente.",
          tokens: 140,
        },
        { role: "user", content: "Sí! Estaba en spam, gracias 🙌" },
        {
          role: "assistant",
          content:
            "Perfecto. Igual te dejo un tip: agregá `noreply@orchester.io` a tus contactos para que no te pase de nuevo.",
          tokens: 95,
        },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.telegram,
      customer: "John Doe",
      email: "john@startup.io",
      status: "closed",
      tags: ["billing", "auto-resolved"],
      csat: 4,
      hoursAgo: 14,
      messages: [
        { role: "user", content: "Where do I download my last invoice?" },
        {
          role: "assistant",
          content:
            "You can grab invoices from Settings → Billing → Invoices. Each one has a download button on the right. Need help with anything specific on the invoice?",
          tokens: 110,
        },
        { role: "user", content: "Got it, thanks!" },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Carlos Méndez",
      email: "carlos@bigco.com",
      status: "escalated",
      tags: ["enterprise", "needs-human"],
      hoursAgo: 1,
      messages: [
        {
          role: "user",
          content:
            "Tenemos requisitos de SSO con SAML y necesitamos saber si Orchester soporta SCIM provisioning. ¿Está disponible en el plan actual?",
        },
        {
          role: "assistant",
          content:
            "SSO con SAML está en el roadmap para 0.3.x junto con SCIM provisioning. Para los detalles específicos de timeline y enterprise tier, voy a derivarte con alguien del equipo. Te respondemos hoy mismo.",
          tokens: 180,
        },
      ],
    },
    {
      agentId: A.multilingualSupport,
      channelId: C.web,
      customer: "Sophie Dubois",
      email: "sophie@frenchco.fr",
      status: "closed",
      tags: ["integrations", "french"],
      csat: 5,
      hoursAgo: 22,
      messages: [
        { role: "user", content: "Bonjour, comment connecter Orchester à Notion ?" },
        {
          role: "assistant",
          content:
            "Bonjour Sophie ! Pour connecter Notion : Réglages → Intégrations → Notion → Connecter. Vous serez redirigée vers OAuth de Notion pour choisir les pages auxquelles donner accès. Une fois connecté, vous pouvez l'utiliser comme outil dans n'importe quel agent.",
          tokens: 210,
        },
        { role: "user", content: "Merci, c'est fait. Ça marche très bien!" },
      ],
    },
    {
      agentId: A.itHelpdesk,
      channelId: C.slack,
      customer: "Pablo Mojeda",
      email: "pablo@orchester.local",
      status: "closed",
      tags: ["vpn", "internal"],
      csat: 5,
      hoursAgo: 2,
      messages: [
        { role: "user", content: "no me conecta el VPN, dice 'authentication failed'" },
        {
          role: "assistant",
          content:
            "Pablo, según el runbook: (1) Verificá que tu password no haya expirado en el AD. (2) Si lo cambiaste hoy, esperá 5min para que sincronice. (3) Reabrí el cliente WireGuard. Si después de eso sigue fallando, decime y te paso la regenera de cert.",
          tokens: 175,
        },
        { role: "user", content: "ok lo cambié hace 10min, ahora funciona 👍" },
      ],
    },
    {
      agentId: A.salesCoach,
      channelId: C.api,
      customer: "Mateo Rodríguez",
      email: "mateo@orchester.local",
      status: "closed",
      tags: ["coaching", "internal"],
      csat: 5,
      hoursAgo: 26,
      messages: [
        {
          role: "user",
          content: "Tengo demo en 1h con CTO de un fintech de 200 personas, ¿qué pregunto?",
        },
        {
          role: "assistant",
          content:
            "Empezá con MEDDIC sin que se note. 3 preguntas clave: (1) 'Hoy, ¿cómo orquestan agentes de IA en producción? ¿Construyen in-house o usan algo?' — saca el Implicit Pain. (2) '¿Quién aprueba budget de infra/AI tools y qué proceso tienen?' — Decision Process + Economic Buyer. (3) '¿Para cuándo necesitan tener esto resuelto?' — Timeline. Si no contestan #3 con fecha concreta, no es real Opportunity todavía. Después de eso, demo cortita (10min máx) y propuesta cerrada.",
          tokens: 380,
        },
        { role: "user", content: "🙌 perfecto, voy con eso" },
      ],
    },
    {
      agentId: A.onboardingBuddy,
      channelId: C.web,
      customer: "Renata Acosta",
      email: "renata@orchester.local",
      status: "closed",
      tags: ["onboarding", "internal"],
      csat: 5,
      hoursAgo: 48,
      messages: [
        { role: "user", content: "Hola! Día 1 acá. ¿Cómo pido el equipo?" },
        {
          role: "assistant",
          content:
            "¡Bienvenida Renata! 🎉 El pedido de equipo se hace en el portal interno de RRHH (people.orchester.local) → 'Equipment Request'. Para devs el default es: MacBook Pro 14\" M4, monitor 4K, teclado/mouse a elección. Suele llegar en 3-5 días hábiles. ¿Necesitás algo más específico?",
          tokens: 195,
        },
        { role: "user", content: "Perfecto, gracias!" },
      ],
    },
    {
      agentId: A.contentWriter,
      channelId: C.api,
      customer: "Joaquín Romero",
      email: "joaquin@orchester.local",
      status: "open",
      tags: ["content", "blog"],
      hoursAgo: 0.5,
      messages: [
        {
          role: "user",
          content: "Tres títulos para un blog post sobre multi-tenancy en plataformas de AI agents",
        },
        {
          role: "assistant",
          content:
            'Te tiro tres ángulos distintos:\n\n1. **"Multi-tenancy is not retrofittable"** — directo, opinión fuerte, te marca posición. Funciona si querés un long-form sobre arquitectura.\n\n2. **"Why your agent platform leaked data: the workspace_id you forgot"** — más clickbait, abre con una historia. Perfecto si querés tracción en Twitter/HN.\n\n3. **"A field guide to tenant isolation in AI workloads"** — académico, evergreen. Si lo tuyo es SEO y backlinks de gente técnica.\n\nDecime cuál te tinca y lo desarrollo.',
          tokens: 290,
        },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.telegram,
      customer: "Anonymous Visitor",
      email: "visitor@example.com",
      status: "closed",
      tags: ["pricing", "deflected"],
      csat: 3,
      hoursAgo: 30,
      messages: [
        { role: "user", content: "How much does Orchester cost?" },
        {
          role: "assistant",
          content:
            "Orchester is open source (Apache 2.0) — you can self-host completely free. Hosted offerings aren't live yet but are coming in Q3. If you're interested in the future managed tier, I can take your email and we'll loop you in when pricing is announced.",
          tokens: 165,
        },
        { role: "user", content: "ok thanks" },
      ],
    },
    {
      agentId: A.multilingualSupport,
      channelId: C.web,
      customer: "Hans Müller",
      email: "hans@deutschecorp.de",
      status: "closed",
      tags: ["features", "german"],
      csat: 5,
      hoursAgo: 36,
      messages: [
        { role: "user", content: "Unterstützt Orchester GDPR-konforme Datenresidenz in Europa?" },
        {
          role: "assistant",
          content:
            "Ja! Beim Self-Hosting bestimmen Sie selbst die Region — alle Daten (inkl. Embeddings im pgvector) bleiben in Ihrer Postgres-Instanz. Für die kommende Managed-Version planen wir EU-Region mit Standort Frankfurt. DPA und SCC sind ab Q3 verfügbar.",
          tokens: 210,
        },
        { role: "user", content: "Vielen Dank, sehr hilfreich." },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Anna Park",
      email: "anna@growthlab.io",
      status: "open",
      tags: ["api", "rate-limit"],
      hoursAgo: 4,
      messages: [
        {
          role: "user",
          content:
            "Getting 429s on /api/v1/flows. We've been making ~150 req/min, that shouldn't be over limit right?",
        },
        {
          role: "assistant",
          content:
            "The default per-workspace flow execution limit is 60/min — bursts get 429. Two paths: (1) upgrade your workspace plan, raises it to 600/min. (2) Run a self-hosted worker fleet and remove the cap entirely. Want me to walk you through option 2?",
          tokens: 200,
        },
      ],
    },
    {
      agentId: A.demoScheduler,
      channelId: C.whatsapp,
      customer: "Esteban Aguirre",
      email: "esteban@latamfintech.co",
      status: "closed",
      tags: ["demo-booked"],
      csat: 5,
      hoursAgo: 18,
      messages: [
        { role: "user", content: "Quiero agendar una demo. Soy CTO" },
        {
          role: "assistant",
          content:
            "Listo Esteban. Te paso 3 slots para esta semana:\n\n• Mar 28 — 10:00 GMT-3\n• Mié 29 — 16:00 GMT-3\n• Vie 31 — 11:00 GMT-3\n\n¿Cuál te queda mejor?",
          tokens: 130,
        },
        { role: "user", content: "Mié 29 — 16hs perfecto" },
        {
          role: "assistant",
          content:
            "Anotado ✓ Mié 29/05 a las 16:00 GMT-3 (45min). Te llega calendar invite a esteban@latamfintech.co. ¿Algo que querés que prepare específicamente para la demo?",
          tokens: 120,
        },
        { role: "user", content: "Multi-tenant + cost cap" },
      ],
    },
    {
      agentId: A.brandVoice,
      channelId: C.api,
      customer: "Valentina López",
      email: "valentina@orchester.local",
      status: "closed",
      tags: ["brand-audit", "internal"],
      csat: 4,
      hoursAgo: 50,
      messages: [
        {
          role: "user",
          content:
            "Revisá este copy: 'Orchester is a revolutionary, game-changing platform that disrupts the AI agent space with cutting-edge multi-tenant architecture.'",
        },
        {
          role: "assistant",
          content:
            'On-brand score: 18/100. Critical issues:\n\n- "revolutionary", "game-changing", "cutting-edge", "disrupts" — 4 marketing clichés en una oración. El brand guide prohíbe los 4 explícitamente.\n- Cero información concreta. Un dev lo lee y desconfía.\n\nCorrected:\n\n> "Orchester is an open-source platform for AI agents. Multi-tenant by design. Postgres-only. Apache 2.0."\n\nMisma idea, 4× menos palabras, 0 marketing-speak.',
          tokens: 250,
        },
        { role: "user", content: "Ouch. Gracias 😅" },
      ],
    },
    {
      agentId: A.onboardingBuddy,
      channelId: C.web,
      customer: "Bruno Vega",
      email: "bruno@orchester.local",
      status: "closed",
      tags: ["pto", "internal"],
      csat: 5,
      hoursAgo: 70,
      messages: [
        { role: "user", content: "Cuántos días de PTO tengo este año?" },
        {
          role: "assistant",
          content:
            "Según la política 2026 actualizada: 20 días hábiles + 5 días flex (no se acumulan al año siguiente, hay que usarlos). Para ver tu balance específico entrá a people.orchester.local → My Time Off. Si querés pedir vacaciones, podés hacerlo desde el mismo lugar — si son <5 días con >2 semanas de anticipación se auto-aprueban.",
          tokens: 215,
        },
        { role: "user", content: "Perfecto, gracias" },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.telegram,
      customer: "Lucas R.",
      email: "lucas.r@indievc.com",
      status: "closed",
      tags: ["mcp", "feature"],
      csat: 5,
      hoursAgo: 60,
      messages: [
        { role: "user", content: "Does the MCP server work with Cursor IDE?" },
        {
          role: "assistant",
          content:
            'Yes! Add this to ~/.cursor/mcp.json:\n\n```json\n{\n  "mcpServers": {\n    "orchester": {\n      "command": "npx",\n      "args": ["-y", "@orchester/mcp-stdio"],\n      "env": {\n        "ORCHESTER_URL": "http://localhost:3333",\n        "ORCHESTER_API_KEY": "your_key"\n      }\n    }\n  }\n}\n```\n\nRestart Cursor, and your flows + agents + KB show up as MCP tools. Works the same in Claude Desktop and any MCP-aware client.',
          tokens: 280,
        },
        { role: "user", content: "Awesome 🙌 working" },
      ],
    },
    {
      agentId: A.itHelpdesk,
      channelId: C.slack,
      customer: "Agustina Méndez",
      email: "agustina@orchester.local",
      status: "closed",
      tags: ["sso", "internal"],
      csat: 5,
      hoursAgo: 33,
      messages: [
        { role: "user", content: "no me entra el Notion, dice que el sso no funciona" },
        {
          role: "assistant",
          content:
            "Probá esto: cerrá la pestaña, andá a notion.so/login → 'Continue with Google' → usa tu mail @orchester. Si te tira 'unauthorized', avisame y te agrego al workspace.",
          tokens: 95,
        },
        { role: "user", content: "fue el continue with google, gracias!" },
      ],
    },
    {
      agentId: A.multilingualSupport,
      channelId: C.web,
      customer: "Diego Romero",
      email: "diego.r@startup.cl",
      status: "closed",
      tags: ["bug", "fixed"],
      csat: 4,
      hoursAgo: 90,
      messages: [
        {
          role: "user",
          content: "Mi agente no me devuelve respuesta, queda 'pensando' para siempre",
        },
        {
          role: "assistant",
          content:
            "Suele ser una de tres cosas: (1) la API key del provider expiró → Settings → Providers → ver si hay un indicador rojo. (2) Spend cap alcanzado → Billing → Usage. (3) Modelo no disponible (ej. claude-opus-3 fue deprecated) → editá el agent y cambiá a claude-sonnet-4-6. ¿Cuál es?",
          tokens: 200,
        },
        { role: "user", content: "Era la API key. Renové y ya funciona" },
      ],
    },
    {
      agentId: A.salesCoach,
      channelId: C.api,
      customer: "Camila Torres",
      email: "camila@orchester.local",
      status: "closed",
      tags: ["objection-handling", "internal"],
      csat: 5,
      hoursAgo: 12,
      messages: [
        { role: "user", content: "El prospect dijo 'preferimos construir esto internamente'" },
        {
          role: "assistant",
          content:
            'Build vs buy es la objeción más común y la más respondible. 3 ángulos para devolverle (elegí 1 según contexto):\n\n1. **Tiempo y costo de oportunidad**: "Si dedican 2 devs Sr durante 6 meses a esto en lugar de a su core, ¿qué dejan de construir? Eso es ~$300k en salarios + 6 meses de roadmap perdido."\n\n2. **Riesgo invisible**: "Lo que cuesta no es construir la v1, es mantenerlo: multi-tenancy, cost guard, audit, MCP, 80 adapters de providers, RBAC. ¿Tienen presupuesto para un equipo dedicado los próximos 3 años?"\n\n3. **Es OSS**: "Buen punto — pueden tomar Orchester (Apache 2.0), forkearlo, y construir encima sin pagarnos nada. La pregunta no es build vs buy, es build-de-cero vs build-encima-de-algo-probado."\n\nEl #3 desarma totalmente la objeción.',
          tokens: 480,
        },
        { role: "user", content: "El #3 nunca lo había pensado así. Gracias 🤯" },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Jamie Park",
      email: "jamie@nyc.io",
      status: "open",
      tags: ["needs-info"],
      hoursAgo: 6,
      messages: [
        { role: "user", content: "any plans for a TypeScript SDK?" },
        {
          role: "assistant",
          content:
            "It's on the 0.2.x roadmap. The shape is going to mirror the REST API: `import Orchester from '@orchester/sdk'; const o = new Orchester({ apiKey }); await o.flows.run(...)`. Want to be tagged when it lands? Drop your email and I'll ping you.",
          tokens: 175,
        },
      ],
    },
    {
      agentId: A.onboardingBuddy,
      channelId: C.web,
      customer: "Tomás Silva",
      email: "tomas@orchester.local",
      status: "closed",
      tags: ["benefits", "internal"],
      csat: 5,
      hoursAgo: 4,
      messages: [
        { role: "user", content: "Cómo doy de alta el plan de salud?" },
        {
          role: "assistant",
          content:
            "El plan de salud (OSDE 410 + dependientes gratis) se activa desde tu primer mes. Andá a people.orchester.local → Benefits → Health → 'Activar'. Si tenés cónyuge / hijos, agregalos en 'Dependents' antes de activar y se incluyen sin costo extra. La cobertura empieza el día 1 del mes siguiente.",
          tokens: 220,
        },
        { role: "user", content: "Listo, activado. Gracias!" },
      ],
    },
    {
      agentId: A.multilingualSupport,
      channelId: C.web,
      customer: "Yuki Tanaka",
      email: "yuki@tokyo-ai.jp",
      status: "closed",
      tags: ["embed", "japanese"],
      csat: 4,
      hoursAgo: 100,
      messages: [
        { role: "user", content: "Can I embed the chat widget in my Vue app?" },
        {
          role: "assistant",
          content:
            'Yes — the widget is framework-agnostic. Drop this in your index.html:\n\n```html\n<script src="https://cdn.orchester.io/widget.js" data-channel-id="YOUR_CHANNEL_ID" defer></script>\n```\n\nThat works in Vue, React, Svelte, plain HTML — anything that renders a script tag. For Vue-specific Composition API hooks (to programmatically open/close, send messages, listen to events), we also ship `@orchester/widget-vue` but it\'s optional.',
          tokens: 250,
        },
        { role: "user", content: "Perfect, embedded. Works great 👍" },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.telegram,
      customer: "Spam Bot",
      email: "spam@example.com",
      status: "closed",
      tags: ["spam"],
      hoursAgo: 200,
      messages: [
        { role: "user", content: "increase your seo with backlinks $$$ click here" },
        { role: "assistant", content: "Looks like spam. Closing this thread.", tokens: 30 },
      ],
    },
  ];

  for (const c of conversations) {
    const convId = createId();
    const startedAt = hoursAgo(c.hoursAgo);
    const endedAt = c.status === "closed" ? hoursAgo(Math.max(0, c.hoursAgo - 0.3)) : null;
    const totalTokens = c.messages.reduce((s, m) => s + (m.tokens ?? 0), 0);
    const totalCost = totalTokens * 0.000003; // ~$3 per million tokens, sonnet-ish

    await db.insert(schema.conversations).values({
      id: convId,
      workspaceId: wsId,
      channelId: c.channelId,
      agentId: c.agentId,
      status: c.status,
      messageCount: c.messages.length,
      durationSeconds: c.messages.length * 90,
      totalCostUsd: totalCost.toFixed(6),
      totalTokens,
      customerName: c.customer,
      customerEmail: c.email,
      externalId: "ext_" + createId().slice(0, 10),
      tags: c.tags,
      csat: c.csat ?? null,
      deflected: c.tags.includes("deflected"),
      startedAt,
      endedAt,
    });

    for (let i = 0; i < c.messages.length; i++) {
      const m = c.messages[i]!;
      await db.insert(schema.messages).values({
        id: createId(),
        conversationId: convId,
        role: m.role,
        content: m.content,
        tokensUsed: m.role === "assistant" ? (m.tokens ?? null) : null,
        costUsd: m.role === "assistant" && m.tokens ? (m.tokens * 0.000003).toFixed(6) : null,
        model: m.role === "assistant" ? "claude-sonnet-4-6" : null,
        createdAt: new Date(startedAt.getTime() + i * 60 * 1000),
      });
    }
  }

  // ── Done ───────────────────────────────────────────────────────────────
  console.log("");
  console.log("✓ Demo seed complete:");
  console.log("  • 6 teams (organigrama)");
  console.log("  • 16 employees with manager hierarchy");
  console.log("  • 14 agents (conversational + flow)");
  console.log("  • 4 knowledge bases (9 docs total)");
  console.log("  • 7 production-grade flows with multi-node DAGs");
  console.log("  • 5 channels (web + slack + telegram + whatsapp + api)");
  console.log("  • 22 realistic conversations with messages + CSAT");
  console.log("");
  console.log("→ Abrí http://localhost:3333 y mostrá tu producto.");
  process.exit(0);
}

// ──────────────────────────────────────────────────────────────────────────
// Wipe (for DEMO_RESET=1)
// ──────────────────────────────────────────────────────────────────────────

async function wipe(db: ReturnType<typeof createDbClient>, wsId: string) {
  // Order matters — child rows before parents (FKs)
  const convs = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.workspaceId, wsId));

  if (convs.length > 0) {
    const ids = convs.map((c) => c.id);
    await db.delete(schema.messages).where(inArray(schema.messages.conversationId, ids));
  }
  await db.delete(schema.conversations).where(eq(schema.conversations.workspaceId, wsId));

  const flows = await db
    .select({ id: schema.flows.id })
    .from(schema.flows)
    .where(eq(schema.flows.workspaceId, wsId));
  if (flows.length > 0) {
    const fids = flows.map((f) => f.id);
    await db.delete(schema.flowRunSteps).where(
      inArray(
        schema.flowRunSteps.runId,
        (
          await db
            .select({ id: schema.flowRuns.id })
            .from(schema.flowRuns)
            .where(inArray(schema.flowRuns.flowId, fids))
        ).map((r) => r.id)
      )
    );
    await db.delete(schema.flowRuns).where(inArray(schema.flowRuns.flowId, fids));
    await db.delete(schema.flowVersions).where(inArray(schema.flowVersions.flowId, fids));
    await db.delete(schema.flowWebhooks).where(inArray(schema.flowWebhooks.flowId, fids));
    await db.delete(schema.flowSchedules).where(inArray(schema.flowSchedules.flowId, fids));
  }
  await db.delete(schema.flows).where(eq(schema.flows.workspaceId, wsId));

  await db.delete(schema.channels).where(eq(schema.channels.workspaceId, wsId));
  await db.delete(schema.agents).where(eq(schema.agents.workspaceId, wsId));

  const kbs = await db
    .select({ id: schema.knowledgeBases.id })
    .from(schema.knowledgeBases)
    .where(eq(schema.knowledgeBases.workspaceId, wsId));
  if (kbs.length > 0) {
    const kbIds = kbs.map((k) => k.id);
    await db.delete(schema.knowledgeChunks).where(inArray(schema.knowledgeChunks.kbId, kbIds));
    await db.delete(schema.knowledgeDocs).where(inArray(schema.knowledgeDocs.kbId, kbIds));
  }
  await db.delete(schema.knowledgeBases).where(eq(schema.knowledgeBases.workspaceId, wsId));

  await db.delete(schema.employees).where(eq(schema.employees.workspaceId, wsId));
  await db.delete(schema.teams).where(eq(schema.teams.workspaceId, wsId));

  console.log("  ✓ Prior demo data wiped");
}

main().catch((e) => {
  console.error("✗ Seed failed:", e);
  process.exit(1);
});
