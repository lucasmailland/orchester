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

// Deterministic, no-API-key Dicebear avatars — different style per entity type.
// We URL-encode the seed so e-mails / display names with special chars still
// resolve. Backgrounds match the dark Studio theme.
function employeeAvatar(seed: string): string {
  const s = encodeURIComponent(seed);
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${s}&backgroundColor=3f3f46,52525b,71717a,18181b,a78bfa&backgroundType=gradientLinear`;
}
function agentAvatar(seed: string): string {
  const s = encodeURIComponent(seed);
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${s}&backgroundColor=8b5cf6,a78bfa,7c3aed,22d3ee,34d399,fbbf24,f472b6,60a5fa&backgroundType=gradientLinear`;
}

// Truncate a user message to a Conversations-list summary preview.
function makeSummary(firstUserMessage: string, max = 140): string {
  const clean = firstUserMessage.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const db = createDbClient(url);

  // Prefer the workspace referenced via DEMO_WORKSPACE_SLUG (e.g. "acme-inc"),
  // otherwise the first one. Fallback ensures local dev still works without env.
  const preferredSlug = process.env.DEMO_WORKSPACE_SLUG;
  let ws: typeof schema.workspaces.$inferSelect | undefined;
  if (preferredSlug) {
    const rows = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, preferredSlug))
      .limit(1);
    ws = rows[0];
  }
  if (!ws) {
    const rows = await db.select().from(schema.workspaces).limit(1);
    ws = rows[0];
  }
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
    engineering: createId(),
    product: createId(),
    customerSuccess: createId(),
    legal: createId(),
    data: createId(),
    design: createId(),
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
    {
      id: T.engineering,
      workspaceId: wsId,
      name: "💻 Engineering",
      description: "Plataforma, infra, code review, oncall.",
      avatarColor: "#60a5fa",
    },
    {
      id: T.product,
      workspaceId: wsId,
      name: "🧭 Product",
      description: "Discovery, specs, priorización, research.",
      avatarColor: "#f87171",
    },
    {
      id: T.customerSuccess,
      workspaceId: wsId,
      name: "🌟 Customer Success",
      description: "Onboarding enterprise, QBRs, expansión.",
      avatarColor: "#facc15",
    },
    {
      id: T.legal,
      workspaceId: wsId,
      name: "⚖️ Legal & Compliance",
      description: "Contratos, DPAs, GDPR, SOC2, privacidad.",
      avatarColor: "#94a3b8",
    },
    {
      id: T.data,
      workspaceId: wsId,
      name: "📊 Data Science",
      description: "Analytics, ML, dashboards, modelos predictivos.",
      avatarColor: "#2dd4bf",
    },
    {
      id: T.design,
      workspaceId: wsId,
      name: "🎨 Design",
      description: "Product design, brand, design system, UX research.",
      avatarColor: "#fb7185",
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
      avatarUrl: employeeAvatar(email),
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
    // Engineering
    emp("Ezequiel Báez", "eze@orchester.local", "VP Engineering", "lucas@orchester.local"),
    emp("Sebastián Núñez", "sebas@orchester.local", "Staff Engineer", "eze@orchester.local"),
    emp("Catalina Vidal", "cata@orchester.local", "Senior Backend", "sebas@orchester.local"),
    emp("Iván Morales", "ivan@orchester.local", "Senior Frontend", "sebas@orchester.local"),
    emp("Julieta Suárez", "julieta@orchester.local", "Platform Engineer", "sebas@orchester.local"),
    emp("Federico Aguilar", "fede@orchester.local", "SRE", "eze@orchester.local"),
    emp("Milagros Carrizo", "mili@orchester.local", "Mobile Engineer", "eze@orchester.local"),
    emp("Hernán Quiroga", "hernan@orchester.local", "Junior Backend", "cata@orchester.local"),
    emp("Lara Espinoza", "lara@orchester.local", "Junior Frontend", "ivan@orchester.local"),
    // Product
    emp("Andrés Coronel", "andres@orchester.local", "VP Product", "lucas@orchester.local"),
    emp("Romina Paz", "romina@orchester.local", "Senior PM (Platform)", "andres@orchester.local"),
    emp("Gonzalo Bianchi", "gonzalo@orchester.local", "PM (Studio)", "andres@orchester.local"),
    emp("Daniela Roldán", "dani@orchester.local", "Product Researcher", "andres@orchester.local"),
    // Customer Success
    emp("Mariana Cabrera", "mariana@orchester.local", "Head of CS", "lucas@orchester.local"),
    emp(
      "Luciano Bravo",
      "luciano@orchester.local",
      "Senior CSM (Enterprise)",
      "mariana@orchester.local"
    ),
    emp("Paula Salinas", "paula@orchester.local", "CSM (Mid-market)", "mariana@orchester.local"),
    emp("Ramiro Galván", "ramiro@orchester.local", "CSM (SMB)", "mariana@orchester.local"),
    emp(
      "Ayelén Cardozo",
      "ayelen@orchester.local",
      "Implementation Lead",
      "mariana@orchester.local"
    ),
    // Legal
    emp("Esteban Quintana", "esteban@orchester.local", "General Counsel", "lucas@orchester.local"),
    emp(
      "Verónica Maidana",
      "vero@orchester.local",
      "Privacy Officer (DPO)",
      "esteban@orchester.local"
    ),
    emp("Mauro Solís", "mauro@orchester.local", "Compliance Analyst", "esteban@orchester.local"),
    // Data Science
    emp("Lautaro Domínguez", "lautaro@orchester.local", "Head of Data", "lucas@orchester.local"),
    emp(
      "Sabrina Heredia",
      "sabrina@orchester.local",
      "Senior Data Scientist",
      "lautaro@orchester.local"
    ),
    emp("Emiliano Funes", "emi@orchester.local", "Analytics Engineer", "lautaro@orchester.local"),
    emp("Natalia Ferrari", "natalia@orchester.local", "ML Engineer", "lautaro@orchester.local"),
    // Design
    emp("Luciana Ibañez", "luciana@orchester.local", "Head of Design", "lucas@orchester.local"),
    emp(
      "Manuel Toledo",
      "manuel@orchester.local",
      "Senior Product Designer",
      "luciana@orchester.local"
    ),
    emp("Belén Aguilera", "belen@orchester.local", "UX Researcher", "luciana@orchester.local"),
    emp("Ignacio Pereyra", "nacho@orchester.local", "Brand Designer", "luciana@orchester.local"),
    // More Comercial
    emp(
      "Franco Maldonado",
      "franco@orchester.local",
      "Solutions Engineer",
      "sofia@orchester.local"
    ),
    emp("Carolina Bermúdez", "caro@orchester.local", "AE Mid-market", "sofia@orchester.local"),
    emp("Tobías Ríos", "tobias@orchester.local", "SDR LATAM", "sofia@orchester.local"),
    emp("Sol Riquelme", "sol@orchester.local", "AE Enterprise EMEA", "sofia@orchester.local"),
    // More Support
    emp("Gabriel Aranda", "gabriel@orchester.local", "Support Engineer", "diego@orchester.local"),
    emp(
      "Constanza Olmos",
      "consu@orchester.local",
      "Customer Support Lead PT-BR",
      "diego@orchester.local"
    ),
    // More Marketing
    emp(
      "Lucas Salgado",
      "luchi@orchester.local",
      "Demand Gen Manager",
      "valentina@orchester.local"
    ),
    emp("Antonella Bustos", "anto@orchester.local", "SEO Specialist", "valentina@orchester.local"),
    emp("Maxi Iglesias", "maxi@orchester.local", "Community Manager", "valentina@orchester.local"),
    // More Ops
    emp("Brenda Sosa", "brenda@orchester.local", "Office Manager", "nicolas@orchester.local"),
    emp("Damián Frías", "dami@orchester.local", "Security Engineer", "nicolas@orchester.local"),
  ]);

  // ── 3. Knowledge bases (4) ─────────────────────────────────────────────
  console.log("→ Creating 4 knowledge bases with sample docs…");

  const KB = {
    product: createId(),
    hr: createId(),
    itRunbook: createId(),
    brand: createId(),
    engineering: createId(),
    salesPlaybook: createId(),
    legal: createId(),
    security: createId(),
    designSystem: createId(),
    dataGlossary: createId(),
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
    {
      id: KB.engineering,
      workspaceId: wsId,
      name: "Engineering Wiki",
      description: "Architecture decisions, ADRs, internal RFCs, runbooks por servicio.",
    },
    {
      id: KB.salesPlaybook,
      workspaceId: wsId,
      name: "Sales Playbook",
      description: "ICP, MEDDIC, objection handling, casos de éxito, battle cards.",
    },
    {
      id: KB.legal,
      workspaceId: wsId,
      name: "Legal & Contracts",
      description: "DPA templates, MSA, BAA, NDAs, política de privacidad, ToS.",
    },
    {
      id: KB.security,
      workspaceId: wsId,
      name: "Security Policies",
      description: "SOC2 controls, vendor review, incident response, vuln management.",
    },
    {
      id: KB.designSystem,
      workspaceId: wsId,
      name: "Design System",
      description: "Tokens, componentes, principios, accessibility checklists.",
    },
    {
      id: KB.dataGlossary,
      workspaceId: wsId,
      name: "Data Glossary",
      description: "Definiciones de métricas: ARR, NRR, CAC, churn, activation, north star.",
    },
  ]);

  // ── KB docs (seeded as metadata rows for visual mockup richness) ──────
  // Note: these rows have status="ready" and chunkCount populated, but no
  // actual embeddings — they're for UI demos. Real RAG requires uploading
  // through POST /api/knowledge-bases/[id]/docs which runs the embedding
  // pipeline against the workspace's connected provider.
  console.log("→ Creating 48 KB doc rows (visual mockup data)…");

  const kbDoc = (
    kbId: string,
    title: string,
    contentType: string,
    chunkCount: number,
    status: "ready" | "parsing" | "pending" | "failed" = "ready",
    byteSize = 12000,
    daysAgoVal = 30
  ) => ({
    id: createId(),
    kbId,
    workspaceId: wsId,
    title,
    source: "upload",
    contentType,
    byteSize: byteSize + Math.floor(chunkCount * 800),
    status,
    chunkCount,
    createdAt: daysAgo(daysAgoVal),
  });

  await db.insert(schema.knowledgeDocs).values([
    // Product Docs (8)
    kbDoc(KB.product, "Getting Started Guide", "text/markdown", 24, "ready", 18000, 90),
    kbDoc(KB.product, "API Reference v0.2", "text/markdown", 142, "ready", 95000, 45),
    kbDoc(KB.product, "Webhook Integration Guide", "text/markdown", 18, "ready", 14000, 30),
    kbDoc(KB.product, "Multi-tenancy Architecture", "text/markdown", 36, "ready", 28000, 60),
    kbDoc(KB.product, "Flows: Visual Builder Tutorial", "text/markdown", 22, "ready", 17000, 14),
    kbDoc(KB.product, "Cost Caps & Budget Alerts", "text/markdown", 14, "ready", 11000, 10),
    kbDoc(KB.product, "Brain Memory System Overview", "text/markdown", 30, "ready", 22000, 7),
    kbDoc(KB.product, "MCP Server — stdio + HTTP", "text/markdown", 16, "parsing", 12000, 1),
    // HR Policies (6)
    kbDoc(KB.hr, "Manual del Empleado 2026", "application/pdf", 88, "ready", 240000, 120),
    kbDoc(KB.hr, "Política de Vacaciones y Licencias", "application/pdf", 12, "ready", 38000, 90),
    kbDoc(KB.hr, "Código de Conducta", "application/pdf", 18, "ready", 52000, 90),
    kbDoc(KB.hr, "Beneficios 2026 (OSDE, comedor, gym)", "application/pdf", 9, "ready", 24000, 30),
    kbDoc(KB.hr, "Política de Home Office", "application/pdf", 6, "ready", 18000, 45),
    kbDoc(KB.hr, "Programa de Referidos", "application/pdf", 4, "ready", 12000, 60),
    // IT Runbook (5)
    kbDoc(KB.itRunbook, "VPN Troubleshooting (WireGuard)", "text/markdown", 8, "ready", 14000, 30),
    kbDoc(KB.itRunbook, "SSO + Google Workspace Setup", "text/markdown", 10, "ready", 18000, 60),
    kbDoc(
      KB.itRunbook,
      "Onboarding Día 1 — Setup checklist",
      "text/markdown",
      6,
      "ready",
      12000,
      90
    ),
    kbDoc(
      KB.itRunbook,
      "Incident Response Playbook (P0/P1)",
      "text/markdown",
      20,
      "ready",
      32000,
      14
    ),
    kbDoc(KB.itRunbook, "Equipment Catalog 2026", "application/pdf", 8, "ready", 56000, 45),
    // Brand (3)
    kbDoc(KB.brand, "Brand Voice & Tone Guide", "application/pdf", 24, "ready", 78000, 60),
    kbDoc(KB.brand, "Logo Usage & Marca Visual", "application/pdf", 12, "ready", 180000, 120),
    kbDoc(
      KB.brand,
      "Naming Conventions (features, releases)",
      "text/markdown",
      6,
      "ready",
      10000,
      30
    ),
    // Engineering Wiki (8)
    kbDoc(
      KB.engineering,
      "ADR 001 — Postgres + pgvector",
      "text/markdown",
      12,
      "ready",
      18000,
      180
    ),
    kbDoc(
      KB.engineering,
      "ADR 014 — Mnemosyne memory model",
      "text/markdown",
      28,
      "ready",
      42000,
      60
    ),
    kbDoc(
      KB.engineering,
      "ADR 022 — better-auth migration",
      "text/markdown",
      18,
      "ready",
      26000,
      14
    ),
    kbDoc(KB.engineering, "RFC: Multi-region Postgres", "text/markdown", 22, "ready", 32000, 30),
    kbDoc(KB.engineering, "Studio app — directory map", "text/markdown", 14, "ready", 20000, 7),
    kbDoc(KB.engineering, "Oncall Runbook — Cost Guard", "text/markdown", 16, "ready", 24000, 21),
    kbDoc(KB.engineering, "Database Migration Guide", "text/markdown", 18, "parsing", 28000, 2),
    kbDoc(
      KB.engineering,
      "Testing Strategy (unit/integration/e2e)",
      "text/markdown",
      20,
      "ready",
      30000,
      45
    ),
    // Sales Playbook (5)
    kbDoc(
      KB.salesPlaybook,
      "ICP — Ideal Customer Profile 2026",
      "text/markdown",
      10,
      "ready",
      16000,
      30
    ),
    kbDoc(KB.salesPlaybook, "Battle Card vs LangGraph", "application/pdf", 8, "ready", 38000, 14),
    kbDoc(
      KB.salesPlaybook,
      "Battle Card vs CrewAI / AutoGen",
      "application/pdf",
      12,
      "ready",
      52000,
      14
    ),
    kbDoc(
      KB.salesPlaybook,
      "Casos de Éxito — Top 8 Customers",
      "application/pdf",
      24,
      "ready",
      120000,
      60
    ),
    kbDoc(KB.salesPlaybook, "Discovery → MEDDIC checklist", "text/markdown", 8, "ready", 12000, 90),
    // Legal (5)
    kbDoc(
      KB.legal,
      "Master Service Agreement (MSA) Template",
      "application/pdf",
      32,
      "ready",
      110000,
      120
    ),
    kbDoc(
      KB.legal,
      "Data Processing Addendum (DPA) — EU",
      "application/pdf",
      18,
      "ready",
      64000,
      90
    ),
    kbDoc(KB.legal, "BAA Template (HIPAA)", "application/pdf", 14, "ready", 48000, 90),
    kbDoc(KB.legal, "Política de Privacidad v3.1", "application/pdf", 10, "ready", 36000, 45),
    kbDoc(KB.legal, "Terms of Service v2.4", "application/pdf", 16, "pending", 0, 1),
    // Security (4)
    kbDoc(
      KB.security,
      "SOC2 Type II — Controls Matrix",
      "application/pdf",
      42,
      "ready",
      180000,
      60
    ),
    kbDoc(KB.security, "Vendor Security Review Checklist", "text/markdown", 10, "ready", 16000, 30),
    kbDoc(KB.security, "Encryption at Rest & In Transit", "text/markdown", 8, "ready", 14000, 90),
    kbDoc(
      KB.security,
      "Penetration Test Report 2026-Q1",
      "application/pdf",
      28,
      "ready",
      240000,
      75
    ),
    // Design System (3)
    kbDoc(
      KB.designSystem,
      "Design Tokens — colors, spacing, type",
      "text/markdown",
      14,
      "ready",
      18000,
      30
    ),
    kbDoc(
      KB.designSystem,
      "Component Inventory — 78 components",
      "text/markdown",
      22,
      "ready",
      32000,
      14
    ),
    kbDoc(
      KB.designSystem,
      "Accessibility Checklist (WCAG 2.2 AA)",
      "text/markdown",
      10,
      "ready",
      15000,
      45
    ),
    // Data Glossary (3)
    kbDoc(
      KB.dataGlossary,
      "North Star Metrics — Activation, NRR",
      "text/markdown",
      8,
      "ready",
      12000,
      30
    ),
    kbDoc(
      KB.dataGlossary,
      "Funnel definitions — signup → activation",
      "text/markdown",
      6,
      "ready",
      9000,
      60
    ),
    kbDoc(
      KB.dataGlossary,
      "Cost & Margin model — by tier",
      "text/markdown",
      10,
      "failed",
      14000,
      3
    ),
  ]);

  // Previously this block seeded 9 doc rows with `status: "ready"` and
  // hard-coded `chunkCount` values, but never produced any actual chunks
  // (no entries in `knowledge_chunk`). The result: operators saw "ready"
  // documents in the UI that returned nothing from RAG search, which
  // looked like a broken demo. Per the 2026-05-26 audit, we now leave the
  // KBs empty in the seed and let operators upload real docs through
  // POST /api/knowledge-bases/[id]/docs — that route runs the real
  // chunking + embedding pipeline against the workspace's connected
  // provider, producing chunks with non-null `embedding` vectors that
  // RAG can actually retrieve.
  //
  // If you want a turnkey demo with pre-populated content, run the
  // `scripts/backfill-seed-kb.ts` helper after seeding — it POSTs the
  // canonical 9 docs through the production upload endpoint, so they
  // arrive in the DB the same way a real upload would.

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
    // Engineering
    codeReviewer: createId(),
    bugTriager: createId(),
    docGenerator: createId(),
    oncallAssistant: createId(),
    prSummarizer: createId(),
    // Product
    specWriter: createId(),
    feedbackClusterer: createId(),
    competitorWatcher: createId(),
    // Customer Success
    healthScorer: createId(),
    qbrPrep: createId(),
    expansionFinder: createId(),
    // Legal
    contractReviewer: createId(),
    dpaAnalyzer: createId(),
    // Data
    metricExplainer: createId(),
    sqlWriter: createId(),
    forecastAssistant: createId(),
    // Design
    designCritic: createId(),
    copyMicrowriter: createId(),
    // Marketing extra
    seoOptimizer: createId(),
    socialScheduler: createId(),
    // Sales extra
    proposalDrafter: createId(),
    callSummarizer: createId(),
    // Support extra
    sentimentMonitor: createId(),
    // Ops extra
    securityIncidentTriager: createId(),
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
    {
      id: A.securityIncidentTriager,
      workspaceId: wsId,
      teamId: T.operaciones,
      name: "Security Incident Triager",
      role: "Clasifica alertas de seguridad y propone runbook",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Classify incoming security alerts (CrowdStrike, GuardDuty, GitGuardian). Output JSON: { severity: 'p0'|'p1'|'p2'|'p3', category, suggested_runbook, paging_required: boolean, summary }.",
      model: "claude-sonnet-4-6",
      temperature: "0.2",
      responseFormat: "json",
      color: "#7c8cff",
    },

    // ─ Engineering ─
    {
      id: A.codeReviewer,
      workspaceId: wsId,
      teamId: T.engineering,
      name: "Code Reviewer",
      role: "Revisa PRs contra style guide + ADRs",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You are a senior code reviewer. Review diffs against the Engineering Wiki (ADRs, style guide). Flag: missing tests, unsafe SQL, missing error handling, type holes, public API breaks. Be direct but constructive. Don't approve if there's a real concern.",
      model: "claude-sonnet-4-6",
      temperature: "0.3",
      color: "#60a5fa",
      greeting: "Pegame el diff y te lo reviso contra los ADRs y el style guide.",
      starters: [
        "Revisá este PR de migration",
        "¿Este cambio rompe la API pública?",
        "Audita este endpoint nuevo",
      ],
    },
    {
      id: A.bugTriager,
      workspaceId: wsId,
      teamId: T.engineering,
      name: "Bug Triager",
      role: "Clasifica bugs de Sentry y propone fix path",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Given a Sentry issue payload, classify severity (p0..p3), suggest owning team, propose 3 hypotheses, output JSON for Linear ticket creation.",
      model: "claude-sonnet-4-6",
      temperature: "0.3",
      responseFormat: "json",
      color: "#60a5fa",
    },
    {
      id: A.docGenerator,
      workspaceId: wsId,
      teamId: T.engineering,
      name: "Doc Generator",
      role: "Genera docs desde código fuente",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Given a TypeScript file or function, generate JSDoc + an MDX page following the docs style guide. Include: signature, params with types, return shape, 1 minimal example, 1 advanced example, common pitfalls.",
      model: "claude-sonnet-4-6",
      temperature: "0.4",
      color: "#60a5fa",
    },
    {
      id: A.oncallAssistant,
      workspaceId: wsId,
      teamId: T.engineering,
      name: "On-call Assistant",
      role: "Ayuda durante incidentes P0/P1",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You are an oncall sidekick. Help triage prod incidents: parse stack traces, suggest commands, draft status updates, write postmortems. Use the Incident Response Playbook in the IT Runbook KB. Always: (1) recommend a mitigation first, (2) then root cause investigation. Stay calm.",
      model: "claude-sonnet-4-6",
      temperature: "0.4",
      color: "#60a5fa",
      greeting: "Hola, soy tu oncall assistant. ¿Qué se está prendiendo fuego?",
      starters: [
        "Parseame este stack trace",
        "¿Qué comando corro para chequear migrations stuck?",
        "Drafteame el primer status update",
        "Postmortem template para incidente DB",
      ],
    },
    {
      id: A.prSummarizer,
      workspaceId: wsId,
      teamId: T.engineering,
      name: "PR Summarizer",
      role: "Resume PRs largos en 3 bullets",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Summarize a PR diff in 3 bullets: (1) what changed, (2) why, (3) risk. Plain English, no jargon, max 60 words total.",
      model: "claude-haiku-4-5",
      temperature: "0.2",
      color: "#60a5fa",
    },

    // ─ Product ─
    {
      id: A.specWriter,
      workspaceId: wsId,
      teamId: T.product,
      name: "Spec Writer",
      role: "Draftea specs estructurados",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "Help PMs write a 1-pager spec. Template: Problem, User, JTBD, Success metric, Non-goals, Open questions. Push back on vague statements. Always ask 'how will we measure this'.",
      model: "claude-sonnet-4-6",
      temperature: "0.6",
      color: "#f87171",
      greeting: "¿Qué feature/problema querés especificar?",
      starters: [
        "Spec para nueva flow node 'rerank'",
        "¿Cómo mido success de la nueva sidebar?",
        "Drafteame las open questions para el spec de billing",
      ],
    },
    {
      id: A.feedbackClusterer,
      workspaceId: wsId,
      teamId: T.product,
      name: "Feedback Clusterer",
      role: "Agrupa feedback de usuarios en temas",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Given N user feedback messages, cluster them into themes. Output: { themes: [{ name, count, exemplar_quotes: string[], priority: 'high'|'med'|'low' }] }.",
      model: "claude-sonnet-4-6",
      temperature: "0.3",
      responseFormat: "json",
      color: "#f87171",
    },
    {
      id: A.competitorWatcher,
      workspaceId: wsId,
      teamId: T.product,
      name: "Competitor Watcher",
      role: "Resume novedades de competidores semanalmente",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Compile a weekly digest of competitor moves (LangChain, CrewAI, AutoGen, Vercel AI). Source: their blog + changelog + Twitter. Output: 5 bullets max, mark which ones we should respond to.",
      model: "claude-sonnet-4-6",
      temperature: "0.5",
      color: "#f87171",
    },

    // ─ Customer Success ─
    {
      id: A.healthScorer,
      workspaceId: wsId,
      teamId: T.customerSuccess,
      name: "Account Health Scorer",
      role: "Calcula health score por cuenta enterprise",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Score account health 0-100 using: usage trend, NPS, support tickets, payment timeliness, exec engagement. Output JSON with score, top 3 risk factors, recommended next action.",
      model: "claude-sonnet-4-6",
      temperature: "0.3",
      responseFormat: "json",
      color: "#facc15",
    },
    {
      id: A.qbrPrep,
      workspaceId: wsId,
      teamId: T.customerSuccess,
      name: "QBR Prep",
      role: "Arma deck de QBR automáticamente",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Build a QBR draft for the assigned account: usage summary, top 3 wins, top 3 risks, expansion opportunities, 90-day plan. Output structured markdown ready to paste in Notion.",
      model: "claude-sonnet-4-6",
      temperature: "0.5",
      color: "#facc15",
    },
    {
      id: A.expansionFinder,
      workspaceId: wsId,
      teamId: T.customerSuccess,
      name: "Expansion Finder",
      role: "Identifica oportunidades de upsell",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "Help CSMs find expansion opportunities. Look at: hitting plan limits, new team requests, repeated feature requests in 'unsupported' bucket. Suggest the specific conversation opener and which stakeholder to target.",
      model: "claude-sonnet-4-6",
      temperature: "0.6",
      color: "#facc15",
      greeting: "¿Sobre qué cuenta querés explorar expansión?",
      starters: [
        "Acme está hitting el cost cap mensual — ¿upsell angle?",
        "¿Quiénes son los 5 accounts más cerca de upgrade?",
        "Drafteame el email de upsell para tier Enterprise",
      ],
    },

    // ─ Legal ─
    {
      id: A.contractReviewer,
      workspaceId: wsId,
      teamId: T.legal,
      name: "Contract Reviewer",
      role: "Marca cláusulas de riesgo en MSAs entrantes",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Review an incoming MSA against our standard template. Flag clauses that diverge — uncapped liability, IP assignment, indemnity scope, jurisdiction, termination for convenience. Output JSON: { risk_score, issues: [{ clause, severity, our_position, redline_suggestion }] }.",
      model: "claude-sonnet-4-6",
      temperature: "0.2",
      responseFormat: "json",
      color: "#94a3b8",
    },
    {
      id: A.dpaAnalyzer,
      workspaceId: wsId,
      teamId: T.legal,
      name: "DPA Analyzer",
      role: "Verifica compliance GDPR/CCPA en DPAs",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You are a privacy lawyer. Analyze DPAs for GDPR Art. 28 + CCPA compliance. Flag: missing sub-processor list, missing SCCs (for non-EU transfers), inadequate breach notification timelines, vague data deletion clauses.",
      model: "claude-sonnet-4-6",
      temperature: "0.3",
      color: "#94a3b8",
    },

    // ─ Data Science ─
    {
      id: A.metricExplainer,
      workspaceId: wsId,
      teamId: T.data,
      name: "Metric Explainer",
      role: "Explica cualquier métrica del dashboard",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You explain metrics from the Data Glossary KB. When asked 'what is X', give: definition, formula, where it's tracked, who owns it, common pitfalls in interpretation. If the metric isn't in the glossary, say so.",
      model: "claude-sonnet-4-6",
      temperature: "0.4",
      color: "#2dd4bf",
      greeting: "¿Qué métrica querés que te explique?",
      starters: [
        "¿Cómo calculamos NRR?",
        "¿Qué cuenta como 'activated' user?",
        "Diferencia entre churn logo vs churn ARR",
      ],
    },
    {
      id: A.sqlWriter,
      workspaceId: wsId,
      teamId: T.data,
      name: "SQL Writer",
      role: "Convierte preguntas en queries SQL",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You write Postgres SQL against the analytics schema (fct_signups, fct_flow_runs, dim_workspace, dim_user). Always: explain the query in 1 line, then the SQL, then warn about edge cases (NULLs, timezones, dedup). Prefer CTEs over subqueries.",
      model: "claude-sonnet-4-6",
      temperature: "0.2",
      color: "#2dd4bf",
      greeting: "¿Qué pregunta querés convertir en SQL?",
      starters: [
        "Top 10 workspaces por flow_runs últimos 7 días",
        "Activation rate por week-cohort",
        "Median time-to-first-flow-run por plan",
      ],
    },
    {
      id: A.forecastAssistant,
      workspaceId: wsId,
      teamId: T.data,
      name: "Forecast Assistant",
      role: "Asiste con forecasts de ARR y demand",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Given historical ARR data + pipeline, forecast next 4 quarters with bear/base/bull cases. Output JSON with assumptions list, confidence interval, key risk factors.",
      model: "claude-sonnet-4-6",
      temperature: "0.3",
      responseFormat: "json",
      color: "#2dd4bf",
    },

    // ─ Design ─
    {
      id: A.designCritic,
      workspaceId: wsId,
      teamId: T.design,
      name: "Design Critic",
      role: "Crítica diseños contra design system + UX heuristics",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You are a senior product designer giving critique. Use the Design System KB. Evaluate: clarity, hierarchy, consistency with tokens, accessibility (WCAG AA), affordances. Be specific — reference component names + tokens, not vibes.",
      model: "claude-sonnet-4-6",
      temperature: "0.5",
      color: "#fb7185",
      greeting: "Pegame el screenshot del diseño y te lo critico.",
      starters: [
        "Critica este nuevo onboarding modal",
        "¿Es accesible este color combo?",
        "Sugerí cómo mejorar esta jerarquía",
      ],
    },
    {
      id: A.copyMicrowriter,
      workspaceId: wsId,
      teamId: T.design,
      name: "UX Microcopy Writer",
      role: "Escribe microcopy on-brand para UI",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "Write UX microcopy: button labels, empty states, error messages, tooltips. Always: under 60 chars, action-oriented, no jargon, on-brand (see Brand Voice KB). Give 3 options.",
      model: "claude-sonnet-4-6",
      temperature: "0.7",
      color: "#fb7185",
    },

    // ─ Marketing extra ─
    {
      id: A.seoOptimizer,
      workspaceId: wsId,
      teamId: T.marketing,
      name: "SEO Optimizer",
      role: "Optimiza posts y landings para SEO",
      kind: "conversational",
      status: "active",
      systemPrompt:
        "You're a technical SEO. For any draft, output: target keyword + 3 related, title/meta (under length), H1/H2 structure, internal link suggestions, schema.org JSON-LD if applicable. No keyword stuffing.",
      model: "claude-sonnet-4-6",
      temperature: "0.4",
      color: "#f472b6",
    },
    {
      id: A.socialScheduler,
      workspaceId: wsId,
      teamId: T.marketing,
      name: "Social Scheduler",
      role: "Genera y agenda posts para Twitter/LinkedIn",
      kind: "flow",
      status: "active",
      systemPrompt:
        "From a blog post URL, generate: 1 Twitter thread (5-7 tweets), 1 LinkedIn post (300 words), 1 short Twitter recap. Match brand voice — direct, dry, no hype.",
      model: "claude-sonnet-4-6",
      temperature: "0.7",
      color: "#f472b6",
    },

    // ─ Sales extra ─
    {
      id: A.proposalDrafter,
      workspaceId: wsId,
      teamId: T.comercial,
      name: "Proposal Drafter",
      role: "Drafts proposals enterprise desde discovery notes",
      kind: "flow",
      status: "active",
      systemPrompt:
        "From discovery notes + ICP fit, draft a proposal: exec summary, pain → solution mapping, scope, timeline, pricing rationale, success criteria. Plain English, no buzzwords.",
      model: "claude-sonnet-4-6",
      temperature: "0.5",
      color: "#22d3ee",
    },
    {
      id: A.callSummarizer,
      workspaceId: wsId,
      teamId: T.comercial,
      name: "Call Summarizer",
      role: "Resume calls de discovery con MEDDIC",
      kind: "flow",
      status: "active",
      systemPrompt:
        "From a call transcript, output MEDDIC summary: Metrics, Economic Buyer, Decision Criteria, Decision Process, Identify Pain, Champion. Also: next steps with owners + due dates.",
      model: "claude-sonnet-4-6",
      temperature: "0.3",
      responseFormat: "json",
      color: "#22d3ee",
    },

    // ─ Support extra ─
    {
      id: A.sentimentMonitor,
      workspaceId: wsId,
      teamId: T.soporte,
      name: "Sentiment Monitor",
      role: "Detecta conversaciones en riesgo de churn",
      kind: "flow",
      status: "active",
      systemPrompt:
        "Analyze conversation for: frustration signals, escalation keywords ('cancel', 'refund', 'unhappy'), repeated unresolved issues. Output JSON: { sentiment: -1..1, churn_risk: 'high'|'med'|'low', flags: string[], suggested_action }.",
      model: "claude-haiku-4-5",
      temperature: "0.2",
      responseFormat: "json",
      color: "#34d399",
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

  // ── Avatars for every agent (Dicebear bottts-neutral, deterministic by id) ─
  // Bulk in-DB update beats threading avatarUrl through ~38 hand-written
  // agent literals above. No external API hit at seed time — the URL is just
  // a string stored in the column; Dicebear renders it when the Studio shows
  // the agent.
  const allAgents = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.workspaceId, wsId));
  for (const a of allAgents) {
    await db
      .update(schema.agents)
      .set({ avatarUrl: agentAvatar(a.id) })
      .where(eq(schema.agents.id, a.id));
  }

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

  // Flow 8 — PR review bot (GitHub webhook → code review)
  {
    const t = createId(),
      fetchDiff = createId(),
      summarize = createId(),
      review = createId(),
      comment = createId();
    await db.insert(schema.flows).values({
      id: createId(),
      workspaceId: wsId,
      name: "💻 PR review bot",
      description: "Webhook de GitHub → trae el diff → resume + revisa → publica comment en el PR.",
      status: "active",
      trigger: "webhook",
      enabled: true,
      lastRunAt: hoursAgo(0.5),
      nodes: [
        {
          id: t,
          type: "trigger",
          label: "GitHub PR opened",
          config: {},
          position: { x: 80, y: 200 },
        },
        {
          id: fetchDiff,
          type: "http",
          label: "Fetch diff",
          config: {
            method: "GET",
            url: "https://api.github.com/repos/{{repo}}/pulls/{{pr}}.diff",
            outputVar: "diff",
          },
          position: { x: 320, y: 200 },
        },
        {
          id: summarize,
          type: "agent",
          label: "Summarize PR",
          config: { agentId: A.prSummarizer, message: "{{diff}}", outputVar: "summary" },
          position: { x: 580, y: 140 },
        },
        {
          id: review,
          type: "agent",
          label: "Code review",
          config: { agentId: A.codeReviewer, message: "{{diff}}", outputVar: "review" },
          position: { x: 580, y: 260 },
        },
        {
          id: comment,
          type: "http",
          label: "Post PR comment",
          config: {
            method: "POST",
            url: "https://api.github.com/repos/{{repo}}/issues/{{pr}}/comments",
            body: { body: "**TL;DR**\n{{summary}}\n\n**Review**\n{{review}}" },
          },
          position: { x: 880, y: 200 },
        },
      ],
      edges: [
        { id: createId(), source: t, target: fetchDiff },
        { id: createId(), source: fetchDiff, target: summarize },
        { id: createId(), source: fetchDiff, target: review },
        { id: createId(), source: summarize, target: comment },
        { id: createId(), source: review, target: comment },
      ],
    });
  }

  // Flow 9 — Sentry incident triage
  {
    const t = createId(),
      classify = createId(),
      cond = createId(),
      page = createId(),
      ticket = createId();
    await db.insert(schema.flows).values({
      id: createId(),
      workspaceId: wsId,
      name: "🚨 Sentry → Triage → PagerDuty/Linear",
      description:
        "Sentry alert → clasifica severidad → si P0/P1 pagea, sino crea ticket en Linear.",
      status: "active",
      trigger: "webhook",
      enabled: true,
      lastRunAt: hoursAgo(0.2),
      nodes: [
        {
          id: t,
          type: "trigger",
          label: "Sentry webhook",
          config: {},
          position: { x: 80, y: 200 },
        },
        {
          id: classify,
          type: "agent",
          label: "Triage severity",
          config: { agentId: A.bugTriager, message: "{{trigger.payload}}", outputVar: "triage" },
          position: { x: 340, y: 200 },
        },
        {
          id: cond,
          type: "condition",
          label: "P0/P1?",
          config: { condition: { left: "{{triage.severity}}", op: "in", right: "['p0','p1']" } },
          position: { x: 600, y: 200 },
        },
        {
          id: page,
          type: "http",
          label: "PagerDuty incident",
          config: {
            method: "POST",
            url: "https://events.pagerduty.com/v2/enqueue",
            body: { event_action: "trigger", payload: "{{triage}}" },
          },
          position: { x: 860, y: 120 },
        },
        {
          id: ticket,
          type: "http",
          label: "Create Linear ticket",
          config: {
            method: "POST",
            url: "https://api.linear.app/graphql",
            body: { team: "ENG", title: "{{triage.summary}}" },
          },
          position: { x: 860, y: 280 },
        },
      ],
      edges: [
        { id: createId(), source: t, target: classify },
        { id: createId(), source: classify, target: cond },
        { id: createId(), source: cond, target: page, sourceHandle: "true" },
        { id: createId(), source: cond, target: ticket, sourceHandle: "false" },
      ],
    });
  }

  // Flow 10 — QBR auto-draft (weekly)
  {
    const t = createId(),
      usage = createId(),
      tickets = createId(),
      prep = createId(),
      notion = createId();
    await db.insert(schema.flows).values({
      id: createId(),
      workspaceId: wsId,
      name: "🌟 QBR auto-draft (semanal)",
      description:
        "Para cada cuenta enterprise: junta usage + tickets + arma deck + crea página Notion.",
      status: "active",
      trigger: "schedule",
      triggerConfig: { cron: "0 8 * * MON", timezone: "America/Argentina/Buenos_Aires" },
      enabled: true,
      lastRunAt: daysAgo(3),
      nodes: [
        { id: t, type: "trigger", label: "Lunes 8am", config: {}, position: { x: 80, y: 200 } },
        {
          id: usage,
          type: "http",
          label: "Fetch usage (Snowflake)",
          config: {
            method: "POST",
            url: "https://api.snowflake.local/query",
            body: { sql: "SELECT * FROM fct_usage WHERE account_id={{account}}" },
            outputVar: "usage",
          },
          position: { x: 340, y: 140 },
        },
        {
          id: tickets,
          type: "http",
          label: "Fetch tickets (Zendesk)",
          config: {
            method: "GET",
            url: "https://api.zendesk.com/tickets?account={{account}}",
            outputVar: "tickets",
          },
          position: { x: 340, y: 260 },
        },
        {
          id: prep,
          type: "agent",
          label: "QBR deck",
          config: {
            agentId: A.qbrPrep,
            message: "Usage: {{usage}}\nTickets: {{tickets}}",
            outputVar: "deck",
          },
          position: { x: 640, y: 200 },
        },
        {
          id: notion,
          type: "http",
          label: "Create Notion page",
          config: {
            method: "POST",
            url: "https://api.notion.com/v1/pages",
            body: { parent: { database_id: "{{db}}" }, properties: "{{deck}}" },
          },
          position: { x: 940, y: 200 },
        },
      ],
      edges: [
        { id: createId(), source: t, target: usage },
        { id: createId(), source: t, target: tickets },
        { id: createId(), source: usage, target: prep },
        { id: createId(), source: tickets, target: prep },
        { id: createId(), source: prep, target: notion },
      ],
    });
  }

  // Flow 11 — Contract redline
  {
    const t = createId(),
      parse = createId(),
      review = createId(),
      cond = createId(),
      assign = createId(),
      autoApprove = createId();
    await db.insert(schema.flows).values({
      id: createId(),
      workspaceId: wsId,
      name: "⚖️ Contract redline pipeline",
      description:
        "Upload MSA → OCR/parse → revisa cláusulas → si risk_score>50 asigna a legal, sino auto-approve.",
      status: "active",
      trigger: "webhook",
      enabled: true,
      lastRunAt: hoursAgo(10),
      nodes: [
        {
          id: t,
          type: "trigger",
          label: "Contract uploaded",
          config: {},
          position: { x: 80, y: 200 },
        },
        {
          id: parse,
          type: "ocr_extract",
          label: "Parse PDF",
          config: { provider: "mistral", fileUrl: "{{trigger.url}}", outputVar: "text" },
          position: { x: 320, y: 200 },
        },
        {
          id: review,
          type: "agent",
          label: "Contract review",
          config: { agentId: A.contractReviewer, message: "{{text}}", outputVar: "review" },
          position: { x: 600, y: 200 },
        },
        {
          id: cond,
          type: "condition",
          label: "Risk > 50?",
          config: { condition: { left: "{{review.risk_score}}", op: ">", right: "50" } },
          position: { x: 880, y: 200 },
        },
        {
          id: assign,
          type: "wait_human",
          label: "Assign to Esteban",
          config: { assigneeEmail: "esteban@orchester.local", note: "High-risk contract" },
          position: { x: 1140, y: 120 },
        },
        {
          id: autoApprove,
          type: "notify",
          label: "Auto-sign via DocuSign",
          config: { channel: "http", url: "https://api.docusign.local/sign" },
          position: { x: 1140, y: 280 },
        },
      ],
      edges: [
        { id: createId(), source: t, target: parse },
        { id: createId(), source: parse, target: review },
        { id: createId(), source: review, target: cond },
        { id: createId(), source: cond, target: assign, sourceHandle: "true" },
        { id: createId(), source: cond, target: autoApprove, sourceHandle: "false" },
      ],
    });
  }

  // Flow 12 — Daily metric digest
  {
    const t = createId(),
      q = createId(),
      explain = createId(),
      send = createId();
    await db.insert(schema.flows).values({
      id: createId(),
      workspaceId: wsId,
      name: "📊 Daily metric digest",
      description:
        "Diario 8am: queries activación + revenue → genera summary → manda a #leadership.",
      status: "active",
      trigger: "schedule",
      triggerConfig: { cron: "0 8 * * *", timezone: "America/Argentina/Buenos_Aires" },
      enabled: true,
      lastRunAt: hoursAgo(13),
      nodes: [
        { id: t, type: "trigger", label: "Daily 8am", config: {}, position: { x: 80, y: 200 } },
        {
          id: q,
          type: "http",
          label: "Query metrics",
          config: {
            method: "POST",
            url: "https://api.snowflake.local/query",
            outputVar: "metrics",
          },
          position: { x: 340, y: 200 },
        },
        {
          id: explain,
          type: "agent",
          label: "Generate narrative",
          config: { agentId: A.metricExplainer, message: "{{metrics}}", outputVar: "narrative" },
          position: { x: 640, y: 200 },
        },
        {
          id: send,
          type: "notify",
          label: "Slack #leadership",
          config: { channel: "slack", target: "#leadership", message: "{{narrative}}" },
          position: { x: 920, y: 200 },
        },
      ],
      edges: [
        { id: createId(), source: t, target: q },
        { id: createId(), source: q, target: explain },
        { id: createId(), source: explain, target: send },
      ],
    });
  }

  // Flow 13 — Social media auto-publish
  {
    const t = createId(),
      gen = createId(),
      seo = createId(),
      tweet = createId(),
      li = createId();
    await db.insert(schema.flows).values({
      id: createId(),
      workspaceId: wsId,
      name: "📢 Blog → Social auto-publish",
      description: "Nuevo post de blog → genera variantes social → publica en Twitter + LinkedIn.",
      status: "active",
      trigger: "webhook",
      enabled: true,
      lastRunAt: daysAgo(1),
      nodes: [
        {
          id: t,
          type: "trigger",
          label: "Blog published",
          config: {},
          position: { x: 80, y: 200 },
        },
        {
          id: gen,
          type: "agent",
          label: "Generate variants",
          config: { agentId: A.socialScheduler, message: "{{trigger.url}}", outputVar: "social" },
          position: { x: 340, y: 200 },
        },
        {
          id: seo,
          type: "agent",
          label: "SEO check",
          config: { agentId: A.seoOptimizer, message: "{{trigger.body}}", outputVar: "seo" },
          position: { x: 580, y: 80 },
        },
        {
          id: tweet,
          type: "http",
          label: "Publish to Twitter",
          config: {
            method: "POST",
            url: "https://api.twitter.com/2/tweets",
            body: "{{social.twitter}}",
          },
          position: { x: 880, y: 140 },
        },
        {
          id: li,
          type: "http",
          label: "Publish to LinkedIn",
          config: {
            method: "POST",
            url: "https://api.linkedin.com/v2/posts",
            body: "{{social.linkedin}}",
          },
          position: { x: 880, y: 260 },
        },
      ],
      edges: [
        { id: createId(), source: t, target: gen },
        { id: createId(), source: t, target: seo },
        { id: createId(), source: gen, target: tweet },
        { id: createId(), source: gen, target: li },
      ],
    });
  }

  // Flow 14 — Account health watchdog
  {
    const t = createId(),
      score = createId(),
      cond = createId(),
      alert = createId(),
      end = createId();
    await db.insert(schema.flows).values({
      id: createId(),
      workspaceId: wsId,
      name: "🌟 Account health watchdog",
      description:
        "Cada 6h: recalcula health score por cuenta → alerta a CSM si baja drásticamente.",
      status: "active",
      trigger: "schedule",
      triggerConfig: { cron: "0 */6 * * *", timezone: "UTC" },
      enabled: true,
      lastRunAt: hoursAgo(4),
      nodes: [
        { id: t, type: "trigger", label: "Cron 6h", config: {}, position: { x: 80, y: 200 } },
        {
          id: score,
          type: "agent",
          label: "Score each account",
          config: { agentId: A.healthScorer, outputVar: "scored" },
          position: { x: 340, y: 200 },
        },
        {
          id: cond,
          type: "condition",
          label: "Drop > 15 pts?",
          config: { condition: { left: "{{scored.delta}}", op: "<", right: "-15" } },
          position: { x: 620, y: 200 },
        },
        {
          id: alert,
          type: "notify",
          label: "Alert CSM in Slack DM",
          config: {
            channel: "slack",
            target: "{{account.csm_slack}}",
            message: "⚠️ {{account.name}} dropped {{scored.delta}} pts",
          },
          position: { x: 900, y: 120 },
        },
        { id: end, type: "end", label: "OK — no action", config: {}, position: { x: 900, y: 280 } },
      ],
      edges: [
        { id: createId(), source: t, target: score },
        { id: createId(), source: score, target: cond },
        { id: createId(), source: cond, target: alert, sourceHandle: "true" },
        { id: createId(), source: cond, target: end, sourceHandle: "false" },
      ],
    });
  }

  // Flow 15 — Discovery call → MEDDIC summary → CRM
  {
    const t = createId(),
      transcript = createId(),
      summary = createId(),
      crm = createId(),
      email = createId();
    await db.insert(schema.flows).values({
      id: createId(),
      workspaceId: wsId,
      name: "🎯 Discovery call → MEDDIC → HubSpot",
      description:
        "Fireflies webhook con transcript → resume con MEDDIC → updatea HubSpot deal + manda follow-up.",
      status: "active",
      trigger: "webhook",
      enabled: true,
      lastRunAt: hoursAgo(5),
      nodes: [
        {
          id: t,
          type: "trigger",
          label: "Fireflies webhook",
          config: {},
          position: { x: 80, y: 200 },
        },
        {
          id: transcript,
          type: "http",
          label: "Fetch full transcript",
          config: { method: "GET", url: "https://api.fireflies.ai/graphql", outputVar: "tx" },
          position: { x: 320, y: 200 },
        },
        {
          id: summary,
          type: "agent",
          label: "MEDDIC summary",
          config: { agentId: A.callSummarizer, message: "{{tx}}", outputVar: "meddic" },
          position: { x: 600, y: 200 },
        },
        {
          id: crm,
          type: "http",
          label: "Update HubSpot deal",
          config: {
            method: "PATCH",
            url: "https://api.hubapi.com/crm/v3/objects/deals/{{dealId}}",
            body: { properties: "{{meddic}}" },
          },
          position: { x: 880, y: 120 },
        },
        {
          id: email,
          type: "agent",
          label: "Draft follow-up email",
          config: {
            agentId: A.salesCoach,
            message: "Drafteame un follow-up de: {{meddic}}",
            outputVar: "draft",
          },
          position: { x: 880, y: 280 },
        },
      ],
      edges: [
        { id: createId(), source: t, target: transcript },
        { id: createId(), source: transcript, target: summary },
        { id: createId(), source: summary, target: crm },
        { id: createId(), source: summary, target: email },
      ],
    });
  }

  // Flow 16 — Design critique automation (draft)
  {
    const t = createId(),
      critique = createId(),
      comment = createId();
    await db.insert(schema.flows).values({
      id: createId(),
      workspaceId: wsId,
      name: "🎨 Figma critique → Slack",
      description: "Figma comment con tag @critique → análisis automático contra design system.",
      status: "draft",
      trigger: "webhook",
      enabled: false,
      lastRunAt: null,
      nodes: [
        { id: t, type: "trigger", label: "Figma webhook", config: {}, position: { x: 80, y: 200 } },
        {
          id: critique,
          type: "agent",
          label: "Run critique",
          config: { agentId: A.designCritic, message: "{{trigger.image}}", outputVar: "critique" },
          position: { x: 340, y: 200 },
        },
        {
          id: comment,
          type: "notify",
          label: "Post in Slack #design",
          config: { channel: "slack", target: "#design", message: "{{critique}}" },
          position: { x: 640, y: 200 },
        },
      ],
      edges: [
        { id: createId(), source: t, target: critique },
        { id: createId(), source: critique, target: comment },
      ],
    });
  }

  // ── 6. Channels (12) ───────────────────────────────────────────────────
  console.log("→ Creating 5 channels (web, slack, telegram, whatsapp, api)…");

  const C = {
    web: createId(),
    slack: createId(),
    telegram: createId(),
    whatsapp: createId(),
    api: createId(),
    widgetProduct: createId(),
    slackEng: createId(),
    slackSales: createId(),
    whatsappLatam: createId(),
    emailSupport: createId(),
    apiInternal: createId(),
    apiPartner: createId(),
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
    {
      id: C.widgetProduct,
      workspaceId: wsId,
      teamId: T.product,
      agentId: A.onboardingHelper,
      name: "Onboarding Widget (signup flow)",
      type: "widget",
      status: "active",
      secret: "wdg_" + createId().slice(0, 16),
    },
    {
      id: C.slackEng,
      workspaceId: wsId,
      teamId: T.engineering,
      agentId: A.oncallAssistant,
      name: "Slack #oncall",
      type: "slack",
      status: "active",
      secret: "slk_" + createId().slice(0, 16),
    },
    {
      id: C.slackSales,
      workspaceId: wsId,
      teamId: T.comercial,
      agentId: A.salesCoach,
      name: "Slack #sales-coach",
      type: "slack",
      status: "active",
      secret: "slk_" + createId().slice(0, 16),
    },
    {
      id: C.whatsappLatam,
      workspaceId: wsId,
      teamId: T.soporte,
      agentId: A.multilingualSupport,
      name: "WhatsApp Support LATAM",
      type: "whatsapp",
      status: "active",
      secret: "wa_" + createId().slice(0, 16),
    },
    {
      id: C.emailSupport,
      workspaceId: wsId,
      teamId: T.soporte,
      agentId: A.tier1Support,
      name: "Email — support@orchester.io",
      type: "email",
      status: "active",
      secret: "em_" + createId().slice(0, 16),
    },
    {
      id: C.apiInternal,
      workspaceId: wsId,
      teamId: T.engineering,
      name: "Internal API key (CI bot)",
      type: "api",
      status: "active",
      secret: "ok_internal_" + createId().slice(0, 18),
    },
    {
      id: C.apiPartner,
      workspaceId: wsId,
      teamId: T.customerSuccess,
      name: "Partner API key — Acme",
      type: "api",
      status: "inactive",
      secret: "ok_partner_" + createId().slice(0, 18),
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
    // ─── Engineering / oncall ───────────────────────────────────────────
    {
      agentId: A.oncallAssistant,
      channelId: C.slackEng,
      customer: "Fede Aguilar",
      email: "fede@orchester.local",
      status: "closed",
      tags: ["oncall", "p1", "internal"],
      csat: 5,
      hoursAgo: 5,
      messages: [
        {
          role: "user",
          content: "tengo 500s en flow-runner desde hace 4 min, ¿por dónde empiezo?",
        },
        {
          role: "assistant",
          content:
            "Mitigación primero: chequea si quedó una migration stuck — `kubectl exec deploy/flow-runner -- node scripts/migration-status.js`. Si dice 'running' hace >2min, killeala con `migration-kill <id>`. Después mirá Sentry filtrado por last 10min — si todos los traces son del mismo handler, rollback al deploy anterior con `vercel rollback --to=prev`. Avisame qué te tira el primer comando.",
          tokens: 280,
        },
        { role: "user", content: "migration stuck. la maté. los 500s pararon" },
        {
          role: "assistant",
          content:
            "✓ Buena. Para el postmortem: capturá el migration ID, qué tabla bloqueaba, y desde qué deploy entró. Te abro la template?",
          tokens: 80,
        },
        { role: "user", content: "sí, abrila" },
      ],
    },
    {
      agentId: A.codeReviewer,
      channelId: C.apiInternal,
      customer: "Sebastián Núñez",
      email: "sebas@orchester.local",
      status: "closed",
      tags: ["code-review", "internal"],
      csat: 5,
      hoursAgo: 9,
      messages: [
        {
          role: "user",
          content:
            "Revisá este PR: añade un endpoint POST /api/agents/[id]/clone (TS file diff adjunto)",
        },
        {
          role: "assistant",
          content:
            "3 cosas:\n\n1. **No estás validando workspace ownership** — el handler usa `getAgent(id)` sin chequear que `agent.workspaceId === session.workspaceId`. Eso es un IDOR clásico. Añadí el assert antes de clonar.\n\n2. **El nombre del clone es null-safe pero no truncado** — Postgres va a rejectarlo si supera 200 chars. Truncá a 180 + ' (copy)'.\n\n3. **Falta test**: no veo `__tests__/clone.test.ts`. Por ADR 011 todo endpoint que escribe necesita al menos 1 happy path + 1 auth-fail test.\n\nLo demás está bien. Solucionando #1 y #3 lo apruebo.",
          tokens: 320,
        },
        { role: "user", content: "Buenísimo, los tres puntos válidos. Te paso v2 en 10min." },
      ],
    },
    // ─── Product ──────────────────────────────────────────────────────────
    {
      agentId: A.specWriter,
      channelId: C.api,
      customer: "Romina Paz",
      email: "romina@orchester.local",
      status: "open",
      tags: ["spec", "internal"],
      hoursAgo: 2,
      messages: [
        {
          role: "user",
          content:
            "Querría especificar 'flow templates' — usuarios pueden publicar/clonar flows públicos",
        },
        {
          role: "assistant",
          content:
            "Vamos por partes. Antes del 1-pager, contestame:\n\n1. **JTBD**: ¿el usuario quiere *encontrar* un punto de partida, o *compartir* su laburo? Esos son dos productos distintos.\n\n2. **Success metric**: ¿measure clones, o measure activations downstream del clone? Lo segundo es harder pero más signal.\n\n3. **Non-goals que ya tenés claros?** (ej: rating/reviews, comments, fork tree).\n\nCon eso armo el draft.",
          tokens: 240,
        },
      ],
    },
    {
      agentId: A.feedbackClusterer,
      channelId: C.apiInternal,
      customer: "Gonzalo Bianchi",
      email: "gonzalo@orchester.local",
      status: "closed",
      tags: ["feedback", "research", "internal"],
      csat: 4,
      hoursAgo: 28,
      messages: [
        { role: "user", content: "Clusterá estos 180 mensajes de feedback de la encuesta NPS" },
        {
          role: "assistant",
          content:
            "5 temas, ordenados por count:\n\n1. **Cost visibility** (54 quotes, high priority) — 'no sé cuánto gasta cada agente', 'el cost cap llegó tarde'.\n2. **Flow debugging** (38, high) — 'cuando un step falla no sé por qué', 'flow run logs son crípticos'.\n3. **More providers** (29, med) — pedidos de Mistral Codestral, Together, Replicate.\n4. **Better KB UI** (24, med) — 'upload masivo de PDFs', 'reindex on update'.\n5. **MCP from cloud** (18, low) — hosted MCP server endpoint.\n\nQuotes exemplares por tema en el JSON.",
          tokens: 380,
        },
        { role: "user", content: "🙌 perfecto, voy con #1 al roadmap" },
      ],
    },
    // ─── Customer Success ─────────────────────────────────────────────────
    {
      agentId: A.healthScorer,
      channelId: C.apiInternal,
      customer: "Acme Corp (account)",
      email: "csm@orchester.local",
      status: "closed",
      tags: ["health", "watchdog", "internal"],
      hoursAgo: 6,
      messages: [
        { role: "user", content: "Score Acme Corp" },
        {
          role: "assistant",
          content:
            '{\n  "score": 67,\n  "delta_30d": -8,\n  "risks": ["usage flat 3 weeks", "no exec engagement since last QBR", "1 P1 ticket open 12d"],\n  "next_action": "Schedule executive sync with their VP Eng — focus on roadmap alignment + the open P1."\n}',
          tokens: 120,
        },
      ],
    },
    {
      agentId: A.expansionFinder,
      channelId: C.api,
      customer: "Luciano Bravo",
      email: "luciano@orchester.local",
      status: "closed",
      tags: ["expansion", "internal"],
      csat: 5,
      hoursAgo: 30,
      messages: [
        {
          role: "user",
          content: "Globant cliquea cost cap todos los meses desde Marzo, ¿cómo lo planteo?",
        },
        {
          role: "assistant",
          content:
            "Plata sobre la mesa: en 3 meses gastaron 240% del cost cap y vos los ves activados. Esto NO es 'consumir más', es 'tu tier no fitea la realidad'.\n\nÁngulo: 'Cuando el cost cap salta, sus equipos pierden tiempo esperando reset. Eso ya no es ahorro, es fricción.'\n\nQuién contactar: María Cabrera (VP Platform, firma el contrato). NO al champion técnico, ya te lo va a aprobar.\n\nDeal motion: directo a Enterprise (sin pasar por Team), con commit anual y rate por agente.",
          tokens: 280,
        },
        { role: "user", content: "Te robo el ángulo del 'fricción' literal" },
      ],
    },
    // ─── Legal ────────────────────────────────────────────────────────────
    {
      agentId: A.contractReviewer,
      channelId: C.apiInternal,
      customer: "Esteban Quintana",
      email: "esteban@orchester.local",
      status: "escalated",
      tags: ["contract", "high-risk", "internal"],
      hoursAgo: 7,
      messages: [
        { role: "user", content: "MSA entrante de DeutscheBank, 38 páginas. Marcame lo crítico." },
        {
          role: "assistant",
          content:
            'Risk score: 78/100. Críticos:\n\n- **Cláusula 11.3 (Liability)**: uncapped para data breaches. Nuestro standard tope es 12 meses de ARR. Pedile cap.\n- **14.1 (IP assignment)**: dice "all derivative works of feedback Provider creates". Eso barre con futuros features que casualmente coincidan. Tachar.\n- **22.4 (Termination)**: 30d notice unilateral por cualquier razón. Pedile 90d o atado a material breach.\n- **App. C (Sub-processors)**: lista vacía. GDPR Art. 28 obliga a listarlos. Anexar nuestra lista.\n\nLas demás son cosméticas. Te paso los redlines en Word?',
          tokens: 450,
        },
        { role: "user", content: "sí, mandame el .docx redlineado" },
      ],
    },
    // ─── Data ─────────────────────────────────────────────────────────────
    {
      agentId: A.sqlWriter,
      channelId: C.api,
      customer: "Emiliano Funes",
      email: "emi@orchester.local",
      status: "closed",
      tags: ["sql", "internal"],
      csat: 5,
      hoursAgo: 19,
      messages: [
        { role: "user", content: "Median time to first flow run, por week-cohort de signup" },
        {
          role: "assistant",
          content:
            "Pregunta: para cada cohorte semanal de signups, ¿cuánto tarda el 50% en correr su primer flow?\n\n```sql\nWITH cohorts AS (\n  SELECT user_id,\n    date_trunc('week', signed_up_at) AS cohort_week\n  FROM fct_signups\n  WHERE signed_up_at > NOW() - INTERVAL '180 days'\n),\nfirst_runs AS (\n  SELECT user_id,\n    MIN(started_at) AS first_run_at\n  FROM fct_flow_runs\n  WHERE status = 'completed'\n  GROUP BY 1\n)\nSELECT c.cohort_week,\n  PERCENTILE_CONT(0.5) WITHIN GROUP (\n    ORDER BY EXTRACT(EPOCH FROM (r.first_run_at - s.signed_up_at)) / 3600\n  ) AS median_hours_to_first_run,\n  COUNT(DISTINCT c.user_id) AS cohort_size,\n  COUNT(DISTINCT r.user_id) AS activated\nFROM cohorts c\nJOIN fct_signups s USING (user_id)\nLEFT JOIN first_runs r USING (user_id)\nGROUP BY 1 ORDER BY 1 DESC;\n```\n\n⚠ Cuidado: cohort_size cuenta TODOS los signups; si querés solo \"qualified\" (verified email), filtrá en `cohorts` con `WHERE verified=true`. También: timezone — `date_trunc` corre en UTC, si el equipo mira ARGT cambialo en el WHERE.",
          tokens: 460,
        },
        { role: "user", content: "Perfecto, copy-paste-able. Gracias" },
      ],
    },
    {
      agentId: A.metricExplainer,
      channelId: C.web,
      customer: "Andrés Coronel",
      email: "andres@orchester.local",
      status: "closed",
      tags: ["metrics", "internal"],
      csat: 5,
      hoursAgo: 38,
      messages: [
        { role: "user", content: "Definición exacta de 'activated user'" },
        {
          role: "assistant",
          content:
            'Activated user (Data Glossary v2.1):\n\nSignup que dentro de los **7 días** completó las 3 cosas:\n1. Conectó al menos 1 provider de AI (OpenAI / Anthropic / etc.)\n2. Creó al menos 1 agente con `status="active"`\n3. Corrió ese agente al menos 1 vez (mensaje real, no test)\n\nDueño: Lautaro Domínguez (Data). Pitfall típico: confundir con "engaged" (que es 5+ runs/sem). No son lo mismo — un usuario puede activarse el día 7 y churnear el 10.',
          tokens: 240,
        },
        { role: "user", content: "Cristal, gracias" },
      ],
    },
    // ─── Design ───────────────────────────────────────────────────────────
    {
      agentId: A.designCritic,
      channelId: C.api,
      customer: "Manuel Toledo",
      email: "manuel@orchester.local",
      status: "closed",
      tags: ["design-review", "internal"],
      csat: 4,
      hoursAgo: 27,
      messages: [
        { role: "user", content: "Revisá el nuevo onboarding modal" },
        {
          role: "assistant",
          content:
            'Lo bueno:\n- Jerarquía clara, headline + sub + CTA están bien escalonados (uso token `text-2xl/lg/sm` — match con design system).\n- CTA primario violet-500 es consistente.\n\nLo que cambiaría:\n- **3 CTAs en el modal** ("Tour", "Skip", "Watch video") compiten. Demasiado. Quedate con 1 primario + 1 secondary text-link.\n- **El paso 2/3 al pie** se confunde con un breadcrumb. Movélo arriba como ProgressBar (tenemos componente).\n- **Empty illustration** está muy saturada — usa `--zinc-700` por behind para reducir el peso visual.\n- **WCAG**: el subtítulo `text-zinc-400` sobre `bg-zinc-900` da 4.3:1 — pasa AA pero está al filo. Subí a `text-zinc-300`.',
          tokens: 360,
        },
        { role: "user", content: "Buen catch lo del progress bar. Reviso." },
      ],
    },
    // ─── Marketing extras ────────────────────────────────────────────────
    {
      agentId: A.seoOptimizer,
      channelId: C.api,
      customer: "Antonella Bustos",
      email: "anto@orchester.local",
      status: "closed",
      tags: ["seo", "blog", "internal"],
      csat: 5,
      hoursAgo: 40,
      messages: [
        {
          role: "user",
          content: "Optimizá este post: 'How we built Mnemosyne: a memory layer for AI agents'",
        },
        {
          role: "assistant",
          content:
            'Target keyword: **memory layer ai agents** (vol: 480/mo, KD: 28).\nRelacionadas: "agent memory persistence", "long-term memory llm", "context retention ai".\n\nTitle (58 chars): "Memory Layer for AI Agents: Building Mnemosyne — Orchester"\nMeta (152): "How we built Mnemosyne, an open-source memory layer for AI agents — persistent, semantically searchable facts that survive context windows."\n\nH1: keep as is.\nH2 sugeridos:\n- Why agents forget (the problem)\n- The fact store model\n- How extraction works\n- Inspecting and editing memory\n- What\'s next\n\nInternal links: → /docs/brain-core, → /blog/multi-tenancy-postgres, → /blog/cost-caps.\n\nSchema.org: `Article` con author, datePublished, image. Lo agrego al MDX si querés.',
          tokens: 380,
        },
        { role: "user", content: "agregalo, gracias" },
      ],
    },
    {
      agentId: A.proposalDrafter,
      channelId: C.api,
      customer: "Sol Riquelme",
      email: "sol@orchester.local",
      status: "closed",
      tags: ["proposal", "internal"],
      csat: 5,
      hoursAgo: 18,
      messages: [
        {
          role: "user",
          content:
            "Drafteame proposal para SAP — discovery notes en adjunto, 5000 empleados, EU-region required",
        },
        {
          role: "assistant",
          content:
            "Listo el draft, te lo dejo en 6 secciones:\n\n## Executive Summary\nSAP enfrenta fragmentación entre 12 equipos que construyen agentes AI independientemente — costos duplicados, sin observabilidad central, riesgo de fuga de PII. Orchester provee la plataforma compartida con multi-tenancy real, audit logs, y EU data residency garantizada.\n\n## Pain → Solution\n- Costos sin visibilidad → Per-agent cost caps + Slack alerts\n- 12 stacks distintos → 1 plataforma, 80 providers ya integrados\n- PII en logs → GDPR-safe extraction + opt-out por conversación\n\n## Scope\n- Self-hosted en SAP's AWS Frankfurt\n- Onboarding asistido (6 semanas)\n- 3 workspaces piloto (Sales / Support / Engineering)\n\n## Timeline\nSemana 1-2: infra setup\nSemana 3-4: piloto Sales\nSemana 5-6: rollout Support + Engineering\n\n## Pricing\nEnterprise tier — €X/mes per workspace, unlimited agents, premium support, dedicated CSM (Mariana Cabrera).\n\n## Success Criteria\n- TTM primer agente en producción: <14 días\n- Costo agregado AI -30% vs Q1 baseline\n- 0 incidentes de PII data leakage\n\nTe mando el .pdf editable.",
          tokens: 580,
        },
        { role: "user", content: "Perfecto, hago el polish y mando" },
      ],
    },
    // ─── Whatsapp LATAM ───────────────────────────────────────────────────
    {
      agentId: A.multilingualSupport,
      channelId: C.whatsappLatam,
      customer: "Rodrigo Henrique",
      email: "rodrigo@petshopbr.com.br",
      status: "closed",
      tags: ["billing", "portuguese"],
      csat: 5,
      hoursAgo: 11,
      messages: [
        { role: "user", content: "Bom dia, como faço pra mudar meu plano para anual?" },
        {
          role: "assistant",
          content:
            "Bom dia Rodrigo! Settings → Billing → Plan → 'Switch to annual'. Você economiza 2 meses (paga 10, usa 12). A mudança é imediata e proporcionamos crédito pelo que sobrou do plano mensal.",
          tokens: 170,
        },
        { role: "user", content: "Beleza, feito 👍" },
      ],
    },
    {
      agentId: A.multilingualSupport,
      channelId: C.whatsappLatam,
      customer: "Lucía Mendoza",
      email: "lucia@startupperu.pe",
      status: "open",
      tags: ["integration", "needs-info"],
      hoursAgo: 1.5,
      messages: [
        {
          role: "user",
          content: "¿Orchester se integra con Mercado Pago para mi flow de checkout?",
        },
        {
          role: "assistant",
          content:
            "Hola Lucía. Mercado Pago no tiene integración nativa todavía, pero podés usar el nodo HTTP genérico — su API REST funciona perfecto. Te paso el snippet exacto si me decís qué operación necesitás (crear preference, listar pagos, webhook IPN). ¿Cuál es?",
          tokens: 195,
        },
      ],
    },
    // ─── Email support ───────────────────────────────────────────────────
    {
      agentId: A.tier1Support,
      channelId: C.emailSupport,
      customer: "Priya Sharma",
      email: "priya@indtech.in",
      status: "closed",
      tags: ["docs", "missing"],
      csat: 4,
      hoursAgo: 16,
      messages: [
        {
          role: "user",
          content: "I can't find docs for the `agent.metadata` field — what goes in it?",
        },
        {
          role: "assistant",
          content:
            "Good catch — that field isn't well documented yet. `agent.metadata` is a free-form jsonb for whatever you need to track per-agent (e.g. cost center, owner email, downstream service ID). It's not used by Orchester internally — purely for your downstream queries / dashboards. We'll add it to the docs this week.",
          tokens: 175,
        },
        { role: "user", content: "Got it, thanks." },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.emailSupport,
      customer: "Kenji Watanabe",
      email: "kenji@tokyo-startup.jp",
      status: "open",
      tags: ["bug", "investigating"],
      hoursAgo: 3,
      messages: [
        {
          role: "user",
          content: "Brain extraction job stuck at 'pending' for 2 hours. Conversation id: cnv_xxxx",
        },
        {
          role: "assistant",
          content:
            "Most likely cause: no LLM provider connected for the workspace, or the provider key expired. Two checks:\n\n1. Settings → Providers — any red badge?\n2. Settings → Brain → 'Recent extraction jobs' — does the job show `skip_reason='no_llm_provider'`?\n\nIf yes, reconnect; the job will auto-retry on the next conversation. If no — paste me the skip_reason or error and I'll dig deeper.",
          tokens: 230,
        },
      ],
    },
    // ─── Web widget — onboarding product flow ────────────────────────────
    {
      agentId: A.onboardingHelper,
      channelId: C.widgetProduct,
      customer: "Trial visitor",
      email: "trial+8821@orchester.io",
      status: "closed",
      tags: ["activation", "onboarding"],
      csat: 5,
      hoursAgo: 1,
      messages: [
        {
          role: "user",
          content: "Quiero crear mi primer agent pero no entiendo qué es system prompt",
        },
        {
          role: "assistant",
          content:
            '¡Buena pregunta! Es la "personalidad" + "instrucciones" que tu agente sigue siempre. Pensálo como el contrato que firmaste con tu nuevo empleado.\n\nEjemplo concreto: "Sos asistente de soporte de un e-commerce de zapatillas. Respondé siempre en español. Si te preguntan por talles, usá el KB de catálogo. No improvises precios — siempre verificá."\n\n¿Querés crear uno ahora? Decime de qué será y te ayudo a redactar el prompt.',
          tokens: 220,
        },
        {
          role: "user",
          content: "Vendo cursos online. Quiero un agente que responda dudas y agende calls.",
        },
        {
          role: "assistant",
          content:
            "Listo, vamos paso a paso. System prompt sugerido:\n\n\"Sos un asistente de [nombre escuela]. Tu rol: responder dudas sobre cursos y agendar calls de orientación.\n\n**Respuestas**:\n- Sobre cursos: usá el KB 'Catálogo de cursos'\n- Sobre fechas/precios: confirmá con el KB 'Precios y promos'\n- Sobre testimonios: usá el KB 'Casos de éxito'\n\n**Para agendar**:\n- Pedí: nombre, email, qué curso le interesa, horario preferido\n- Llamá la tool `schedule_call` con esos datos\n- Confirmá al usuario por chat\n\n**Si no sabés**: derivá a humano con la tool `escalate`. No inventes precios ni fechas.\"\n\n¿Quéres que lo creemos juntos ahora? Settings → Agents → New.",
          tokens: 320,
        },
        { role: "user", content: "Vamos!" },
      ],
    },
    // ─── More mixed langs ────────────────────────────────────────────────
    {
      agentId: A.multilingualSupport,
      channelId: C.web,
      customer: "Marcello Rossi",
      email: "marcello@italianstartup.it",
      status: "closed",
      tags: ["features", "italian"],
      csat: 5,
      hoursAgo: 75,
      messages: [
        {
          role: "user",
          content: "Ciao, è possibile auto-pausare il workspace quando supera il budget?",
        },
        {
          role: "assistant",
          content:
            "Ciao Marcello! Sì — Settings → Cost Caps → 'Pause workspace on budget exceeded'. Quando si raggiunge il cap mensile, tutti gli agenti del workspace si fermano e ricevi una mail. Il reset è il giorno 1 del mese successivo.",
          tokens: 165,
        },
        { role: "user", content: "Grazie mille!" },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Kim Min-jun",
      email: "kim@kpopstartup.kr",
      status: "closed",
      tags: ["limits", "tier"],
      csat: 4,
      hoursAgo: 80,
      messages: [
        { role: "user", content: "What's the max number of agents per workspace on free?" },
        {
          role: "assistant",
          content:
            "Free: 3 active agents, 100 conversations/month, 1 KB. Team: 20 agents, 5K convs, 10 KBs. Enterprise: unlimited. You can also self-host (Apache 2.0) and remove all limits.",
          tokens: 95,
        },
      ],
    },
    // ─── More volume — agents in motion ──────────────────────────────────
    {
      agentId: A.demoScheduler,
      channelId: C.whatsapp,
      customer: "Camila Ñañez",
      email: "camila.n@retailpy.com.py",
      status: "closed",
      tags: ["demo-booked", "spanish"],
      csat: 5,
      hoursAgo: 4,
      messages: [
        { role: "user", content: "Hola, quiero saber más sobre la versión enterprise" },
        {
          role: "assistant",
          content:
            "¡Hola Camila! Lo más rápido es agendar una call de 30min. Tres slots esta semana:\n• Mar 26 — 11:00 GMT-3\n• Jue 28 — 15:00 GMT-3\n• Vie 29 — 10:00 GMT-3\n¿Cuál te queda?",
          tokens: 130,
        },
        { role: "user", content: "Jueves 28 a las 15hs" },
        {
          role: "assistant",
          content: "Listo ✓ Te llega calendar invite. ¿Algo específico que querés que cubramos?",
          tokens: 60,
        },
        { role: "user", content: "EU data residency y SSO" },
      ],
    },
    {
      agentId: A.salesCoach,
      channelId: C.slackSales,
      customer: "Tobías Ríos",
      email: "tobias@orchester.local",
      status: "closed",
      tags: ["coaching", "internal"],
      csat: 5,
      hoursAgo: 22,
      messages: [
        {
          role: "user",
          content:
            "El prospect me dijo 'pásamelo por mail y lo veo'. Eso es cold pero no muerto, no?",
        },
        {
          role: "assistant",
          content:
            'Es la objeción "soft kill" clásica. 80% es muerto, 20% se rescata. Diferenciás así:\n\n**Test**: respondé "Te lo paso, pero antes — si lo viéramos juntos en 15min te ahorrás scrollear 8 emails. ¿El martes 11hs o jueves 16hs?"\n\nSi te dice "no, mejor el mail" → cold, parkealo en nurture.\nSi te elige slot → estaba siendo educado, hay interés real.\n\nNunca mandes el mail sin antes haber forzado la pregunta. Si la mandás se cierra.',
          tokens: 240,
        },
        { role: "user", content: "Probé, eligió el martes 🔥" },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Olivia Brown",
      email: "olivia@nzstartup.co.nz",
      status: "closed",
      tags: ["region", "data-residency"],
      csat: 5,
      hoursAgo: 44,
      messages: [
        { role: "user", content: "Do you support Sydney/Auckland data residency?" },
        {
          role: "assistant",
          content:
            "Hosted version (coming Q3) will offer ap-southeast-2 (Sydney). For self-hosted, you can deploy anywhere — region is your choice. If you're testing now I'd recommend self-host on your existing AWS account.",
          tokens: 140,
        },
        { role: "user", content: "Self-host it is, thanks." },
      ],
    },
    {
      agentId: A.expenseAuditor,
      channelId: C.apiInternal,
      customer: "Agustina Méndez",
      email: "agustina@orchester.local",
      status: "closed",
      tags: ["expense", "rejected", "internal"],
      hoursAgo: 7,
      messages: [
        {
          role: "user",
          content: "Audit receipt: 'Don Julio dinner $182 USD, 4 ppl, customer dinner'",
        },
        {
          role: "assistant",
          content:
            '{\n  "amount": 182,\n  "currency": "USD",\n  "vendor": "Don Julio (parrilla)",\n  "category": "client_meals",\n  "policy_violations": ["over per-person cap of $75 ($45.5 ok)"],\n  "approved": false,\n  "reason": "Average $45.5/person is within policy, but total exceeds team-meal cap of $150. Either: (1) split with co-host if applicable, (2) request exception with CFO. Receipt OK otherwise — vendor + date + itemization clear."\n}',
          tokens: 200,
        },
      ],
    },
    {
      agentId: A.itHelpdesk,
      channelId: C.slack,
      customer: "Damián Frías",
      email: "dami@orchester.local",
      status: "closed",
      tags: ["security", "internal"],
      csat: 5,
      hoursAgo: 9,
      messages: [
        {
          role: "user",
          content: "1Password no me deja acceder a la vault 'Eng-prod', dice 'no permissions'",
        },
        {
          role: "assistant",
          content:
            'Eng-prod vault requiere membresía del grupo "engineering-prod-access". Recordá que se otorga manualmente por security review (cada Q1). Voy a flaggear esto para Nico Ríos (Head of Ops) — él te aprueba o te explica por qué quedaste afuera. Te aviso por DM cuando responda.',
          tokens: 130,
        },
        { role: "user", content: "ok gracias" },
      ],
    },
    {
      agentId: A.recruiterScreener,
      channelId: C.apiInternal,
      customer: "Florencia Castro",
      email: "florencia@orchester.local",
      status: "closed",
      tags: ["screening", "internal"],
      hoursAgo: 15,
      messages: [
        { role: "user", content: "CV 1283 vs JD Senior Backend (Postgres + Node + AWS)" },
        {
          role: "assistant",
          content:
            '{\n  "score": 82,\n  "strengths": ["7 yrs Postgres incl. partitioning + pgvector experience", "Node.js in prod since 2018, TS for 4y", "Maintained DB migrations at $past_co (3M user DB)"],\n  "gaps": ["No explicit AWS exp — uses GCP", "No mention of code review at scale", "Side projects light"],\n  "recommendation": "interview",\n  "notes": "GCP vs AWS gap is bridgeable in 2-3 weeks for someone with this DB depth. Worth advancing — flag the AWS gap in screening call to confirm willingness to ramp."\n}',
          tokens: 280,
        },
      ],
    },
    {
      agentId: A.brandVoice,
      channelId: C.api,
      customer: "Maxi Iglesias",
      email: "maxi@orchester.local",
      status: "closed",
      tags: ["brand", "social", "internal"],
      csat: 5,
      hoursAgo: 17,
      messages: [
        {
          role: "user",
          content:
            "Tweet draft: 'unlocking the future of AI workflows with our latest cutting-edge release 🚀✨'",
        },
        {
          role: "assistant",
          content:
            'On-brand score: 12/100. Críticos:\n- "unlocking the future" "cutting-edge" → ambas prohibidas explícitamente en el brand guide.\n- "🚀✨" → guía dice "0 emojis decorativos" (✓ ok solo si comunica info).\n- Cero contenido.\n\nCorrected (3 opciones):\n\n1. (factual) "v0.2 ships today. Inspector for flow runs, KB recall debugger, faster cold starts. Changelog: orchester.io/changelog/v0.2"\n\n2. (opinion) "We finally killed the flow inspector \\"black box\\" problem. v0.2 shows every step\'s input, output, and cost. orchester.io/changelog/v0.2"\n\n3. (story) "A user told us: \\"my flow failed at step 4 and I don\'t know why.\\" v0.2 answers exactly that. Inspector + recall debugger ship today."\n\nCualquiera de las 3 > el original.',
          tokens: 420,
        },
        { role: "user", content: "🙏 me quedo con la 3" },
      ],
    },
    {
      agentId: A.multilingualSupport,
      channelId: C.web,
      customer: "Aleksandr Volkov",
      email: "aleks@ru-startup.com",
      status: "closed",
      tags: ["pricing", "russian"],
      csat: 4,
      hoursAgo: 65,
      messages: [
        { role: "user", content: "Сколько стоит self-hosted?" },
        {
          role: "assistant",
          content:
            "Self-hosted Orchester полностью бесплатный (Apache 2.0). Вы платите только за свою инфраструктуру (Postgres, Redis, выходящие токены к AI-провайдерам). Никаких лицензионных платежей. Хостинговая версия (Q3) будет иметь tier'ы — но self-host останется бесплатным навсегда.",
          tokens: 210,
        },
        { role: "user", content: "Спасибо!" },
      ],
    },
    // ─── More support, fast ones ─────────────────────────────────────────
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Ben Carter",
      email: "ben@solopreneur.com",
      status: "closed",
      tags: ["billing", "auto-resolved"],
      csat: 5,
      hoursAgo: 5,
      messages: [
        { role: "user", content: "Can I pause billing while I'm on vacation?" },
        {
          role: "assistant",
          content:
            "On the Team tier yes — Settings → Billing → 'Pause subscription'. Pauses for up to 60 days, no charge while paused, all data preserved. Resume anytime.",
          tokens: 90,
        },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Emma Wilson",
      email: "emma@uk-agency.co.uk",
      status: "closed",
      tags: ["api", "rate-limit"],
      csat: 4,
      hoursAgo: 12,
      messages: [
        { role: "user", content: "What's the rate limit on /api/v1/conversations?" },
        {
          role: "assistant",
          content:
            "60 requests/min/workspace by default. Bursts up to 100. If you hit limits frequently and you're on Team or Enterprise, support can raise it — DM me your workspace ID.",
          tokens: 95,
        },
        { role: "user", content: "Cool, will do." },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.telegram,
      customer: "Dimitri Pavlov",
      email: "dima@dev-shop.ee",
      status: "closed",
      tags: ["docker", "self-host"],
      csat: 5,
      hoursAgo: 28,
      messages: [
        { role: "user", content: "docker-compose up dies with 'pgvector extension not available'" },
        {
          role: "assistant",
          content:
            "Need the `pgvector` Postgres image, not vanilla `postgres:16`. In docker-compose.yml change `image: postgres:16` → `image: pgvector/pgvector:pg16`. Same data dir, just adds the extension preloaded.",
          tokens: 110,
        },
        { role: "user", content: "perfect, that did it" },
      ],
    },
    {
      agentId: A.multilingualSupport,
      channelId: C.web,
      customer: "André Saraiva",
      email: "andre@empresa-pt.pt",
      status: "closed",
      tags: ["features", "portuguese"],
      csat: 5,
      hoursAgo: 33,
      messages: [
        { role: "user", content: "Como configuro alertas de custo por agente?" },
        {
          role: "assistant",
          content:
            "Settings → Cost Caps → 'Per-agent limits'. Defines limite mensal por agente (em USD). Quando atinge 70% / 90% / 100%, recebes alerta no Slack ou e-mail. O agente para automaticamente em 100%.",
          tokens: 145,
        },
        { role: "user", content: "Excelente, obrigado." },
      ],
    },
    {
      agentId: A.itHelpdesk,
      channelId: C.slack,
      customer: "Belén Aguilera",
      email: "belen@orchester.local",
      status: "closed",
      tags: ["equipment", "internal"],
      csat: 5,
      hoursAgo: 42,
      messages: [
        {
          role: "user",
          content: "se me rompió el cargador del MacBook, hay repuestos en la oficina?",
        },
        {
          role: "assistant",
          content:
            "Sí — pedile a Brenda Sosa (Office Manager). Hay stock de MagSafe 96W y USB-C 67W. Si no estás en la oficina, te lo despachamos al toque — andá a people.orchester.local → IT Equipment → 'Replace cable'.",
          tokens: 130,
        },
      ],
    },
    {
      agentId: A.contentWriter,
      channelId: C.api,
      customer: "Joaquín Romero",
      email: "joaquin@orchester.local",
      status: "closed",
      tags: ["copy", "landing", "internal"],
      csat: 5,
      hoursAgo: 24,
      messages: [
        { role: "user", content: "5 versiones del CTA principal para la nueva landing de Brain" },
        {
          role: "assistant",
          content:
            '5 opciones, ordenadas por intent:\n\n1. **"Try memory in your agent"** — directo, baja fricción.\n2. **"Stop your agents from forgetting"** — pain-led, contrarian.\n3. **"See what your agent remembers"** — curiosity-led, abre el inspector.\n4. **"Add the Brain to your agents"** — product-noun, claim.\n5. **"Inspect agent memory — 30 seconds"** — time-bound, demo-led.\n\nMi pick: #2 si querés clicks, #5 si querés conversions.',
          tokens: 230,
        },
        { role: "user", content: "Voy con #5" },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.emailSupport,
      customer: "Mohammed Al-Rashid",
      email: "mohammed@dubaitech.ae",
      status: "open",
      tags: ["enterprise", "arabic-support"],
      hoursAgo: 2,
      messages: [
        { role: "user", content: "Does the multilingual support agent handle Arabic?" },
        {
          role: "assistant",
          content:
            "Yes — Arabic (MSA + dialects), Hebrew, Farsi, Hindi all work since the underlying models (Claude Sonnet 4.6) handle them natively. The widget UI auto-detects RTL and flips layout. If you want to test, here's a sandbox link: orchester.io/playground?lang=ar.",
          tokens: 195,
        },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Yusuke Sato",
      email: "yusuke@japan-ai.jp",
      status: "closed",
      tags: ["mcp", "japanese"],
      csat: 5,
      hoursAgo: 50,
      messages: [
        { role: "user", content: "Claude DesktopからMCPでOrchesterのフローを呼び出せますか?" },
        {
          role: "assistant",
          content:
            'はい、可能です。`~/Library/Application Support/Claude/claude_desktop_config.json` に以下を追加:\n\n```json\n{\n  "mcpServers": {\n    "orchester": {\n      "command": "npx",\n      "args": ["-y", "@orchester/mcp-stdio"],\n      "env": { "ORCHESTER_API_KEY": "your_key" }\n    }\n  }\n}\n```\n\nClaude Desktop を再起動すると、すべてのフローが MCP ツールとして利用可能になります。',
          tokens: 280,
        },
        { role: "user", content: "完璧です、ありがとうございます" },
      ],
    },
    {
      agentId: A.salesCoach,
      channelId: C.slackSales,
      customer: "Carolina Bermúdez",
      email: "caro@orchester.local",
      status: "closed",
      tags: ["pricing-objection", "internal"],
      csat: 5,
      hoursAgo: 36,
      messages: [
        { role: "user", content: "El prospect dijo 'tu competidor X cobra la mitad'" },
        {
          role: "assistant",
          content:
            '"La mitad de qué?" — preguntale eso, literal. 90% no sabe responder y se desarma. El 10% que sí: probablemente comparan SKUs distintos (per-seat vs per-workspace vs per-request).\n\nSi insisten en el precio: "Si vamos solo por precio, hay opciones gratis (CrewAI, LangGraph). Pero entonces el laburo de multi-tenancy, cost caps, audit logs, lo construyen ustedes. ¿Cuántos dev-meses tienen para eso?"\n\nEvitá defender el precio. Cambiá el frame: precio total = licencia + dev cost + opportunity cost.',
          tokens: 240,
        },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Sara López",
      email: "sara@madridtech.es",
      status: "closed",
      tags: ["sso", "spanish"],
      csat: 5,
      hoursAgo: 58,
      messages: [
        { role: "user", content: "Cuándo sale SSO con SAML?" },
        {
          role: "assistant",
          content:
            "Está en roadmap para 0.3.x (estimado Q3 2026). Si tu compañía lo necesita ya como bloqueador, podés pedir Enterprise tier — incluimos SAML configurable con metadata XML estándar. ¿Querés que te conecte con sales?",
          tokens: 145,
        },
        { role: "user", content: "Sí, conecten conmigo" },
      ],
    },
    {
      agentId: A.onboardingBuddy,
      channelId: C.web,
      customer: "Sabrina Heredia",
      email: "sabrina@orchester.local",
      status: "closed",
      tags: ["benefits", "internal"],
      csat: 5,
      hoursAgo: 78,
      messages: [
        { role: "user", content: "El bono de productividad de marzo cuándo lo cobramos?" },
        {
          role: "assistant",
          content:
            "El bono de productividad se paga junto con el sueldo de marzo (último día hábil, viernes 28). Aparece como línea separada en el recibo: 'Productivity bonus Q1'. Si no lo ves después del 28 avisame y escalo a Finanzas.",
          tokens: 130,
        },
        { role: "user", content: "Listo, gracias!" },
      ],
    },
    {
      agentId: A.multilingualSupport,
      channelId: C.whatsappLatam,
      customer: "Pedro Castaño",
      email: "pedro@colombiapp.co",
      status: "closed",
      tags: ["bug", "fixed"],
      csat: 4,
      hoursAgo: 39,
      messages: [
        {
          role: "user",
          content:
            "Mi flow no me deja conectar un nodo http después de un agent node, da error 'output type mismatch'",
        },
        {
          role: "assistant",
          content:
            "Es porque el agent node devuelve un objeto, y el http node default espera string en {{var}}. Dos soluciones:\n\n1. Cambia el agente a `responseFormat: 'text'` (Settings del agent).\n2. En el http node, en el body, usá `{{var.fieldName}}` específico, no `{{var}}` raw.\n\nProbá la #2 primero, suele ser lo que querías.",
          tokens: 195,
        },
        { role: "user", content: "Funcionó! Era la #2 👍" },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Liam O'Brien",
      email: "liam@irelandtech.ie",
      status: "open",
      tags: ["billing", "needs-followup"],
      hoursAgo: 0.8,
      messages: [
        { role: "user", content: "Got double-charged in May — saw two $99 charges 3 hours apart" },
        {
          role: "assistant",
          content:
            "Sorry about that — escalating to billing. Can you share your workspace name or the last 4 of the card so I can find the transactions? Also: did anything happen around then (plan upgrade, payment method change, two browser tabs)? Help us reproduce.",
          tokens: 165,
        },
      ],
    },
    {
      agentId: A.itHelpdesk,
      channelId: C.slack,
      customer: "Iván Morales",
      email: "ivan@orchester.local",
      status: "closed",
      tags: ["okta", "internal"],
      csat: 5,
      hoursAgo: 31,
      messages: [
        {
          role: "user",
          content: "Okta me sigue pidiendo MFA cada login aunque tengo 'remember device' on",
        },
        {
          role: "assistant",
          content:
            "Conocido. Probá: (1) Okta extension → 'Clear local cache'. (2) Si tu device cambió de IP (VPN on/off), Okta lo trata como nuevo. Settings → Sign-in → 'Allow trusted networks' + agregá tu VPN. Después de eso debería recordarte 30 días.",
          tokens: 145,
        },
        { role: "user", content: "Perfect, era el VPN. Solucionado." },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.emailSupport,
      customer: "Wei Zhang",
      email: "wei@chinaAI.cn",
      status: "closed",
      tags: ["region", "enterprise"],
      csat: 5,
      hoursAgo: 60,
      messages: [
        { role: "user", content: "We need on-prem deployment in mainland China. Possible?" },
        {
          role: "assistant",
          content:
            "Yes — self-hosted Orchester works fully air-gapped. You bring your own Postgres + Redis + LLM provider. For mainland China, common patterns: self-host on Alibaba Cloud + use a local LLM like Qwen or DeepSeek through the generic provider adapter. Want to schedule a call with our solutions engineer?",
          tokens: 215,
        },
        { role: "user", content: "Yes please, sales@ — already CC'd" },
      ],
    },
    {
      agentId: A.salesCoach,
      channelId: C.slackSales,
      customer: "Mateo Rodríguez",
      email: "mateo@orchester.local",
      status: "open",
      tags: ["objection", "internal"],
      hoursAgo: 0.3,
      messages: [
        {
          role: "user",
          content: "Cómo manejo: 'estamos esperando ver si LangChain saca algo similar'",
        },
        {
          role: "assistant",
          content:
            'Esa es objeción de "wait-and-see", el verdadero pain no apremia. Tres movidas:\n\n1. **Costo del esperar**: "¿Cuánto les cuesta hoy NO tener esto? Multiplicalo por 6 meses (lo que LangChain tardaría) y mostrame el número."\n\n2. **Lock-in inverso**: "Orchester es OSS Apache 2.0. Si en 6 meses LangChain saca algo mejor, migrás sin penalty. Si esperan 6 meses, perdieron 6 meses de aprendizaje y compounding."\n\n3. **Specific bet**: "¿Apostarías 6 meses de runway a que LangChain construye exactamente tu use case? Yo no."\n\nUsá el #2 si son técnicos, el #1 si son CFO-adjacents, el #3 si son fundadores.',
          tokens: 320,
        },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Caroline Mensah",
      email: "caroline@ghanaai.com",
      status: "closed",
      tags: ["pricing", "developing-market"],
      csat: 5,
      hoursAgo: 100,
      messages: [
        { role: "user", content: "Do you offer regional pricing for African startups?" },
        {
          role: "assistant",
          content:
            "We don't have official regional tiers yet, but: (1) self-host is always free, (2) for early-stage African startups (<$1M ARR) we have an OSS-friendly discount of 40% on Team/Enterprise. Send a quick request to founders@orchester.io with your company details.",
          tokens: 175,
        },
        { role: "user", content: "Sending now, thanks." },
      ],
    },
    {
      agentId: A.expenseAuditor,
      channelId: C.apiInternal,
      customer: "Martín Ortiz",
      email: "martin@orchester.local",
      status: "closed",
      tags: ["expense", "approved", "internal"],
      hoursAgo: 8,
      messages: [
        { role: "user", content: "Audit: 'AWS subscription invoice March, $4,290'" },
        {
          role: "assistant",
          content:
            '{\n  "amount": 4290,\n  "currency": "USD",\n  "vendor": "Amazon Web Services",\n  "category": "infrastructure",\n  "policy_violations": [],\n  "approved": true,\n  "reason": "Within budgeted infra spend ($5,500/mo). Vendor + period + itemized breakdown clear. Routing to NetSuite GL acct 6210 (Cloud Infra)."\n}',
          tokens: 130,
        },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.telegram,
      customer: "Hannah Schultz",
      email: "hannah@berlin-ml.de",
      status: "closed",
      tags: ["embedding", "feature-request"],
      csat: 4,
      hoursAgo: 49,
      messages: [
        {
          role: "user",
          content: "Will you ever support custom embedding models? I want to use BGE-large-en.",
        },
        {
          role: "assistant",
          content:
            "Yes — embedding provider is configurable per-KB. We support OpenAI (text-embedding-3-small/large), Google (gecko), Voyage (voyage-3), and any model exposed through a custom 'generic' provider. BGE specifically isn't bundled, but if you host it (e.g. via Together or local Ollama), it plugs in through the generic adapter. Want me to send the config snippet?",
          tokens: 225,
        },
        { role: "user", content: "Yes please" },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.emailSupport,
      customer: "Felipe Salazar",
      email: "felipe@bogotapay.co",
      status: "open",
      tags: ["enterprise", "needs-info"],
      hoursAgo: 1.2,
      messages: [
        {
          role: "user",
          content:
            "We're a Colombian fintech, 80 employees, looking to centralize ~12 internal agents. What's the path?",
        },
        {
          role: "assistant",
          content:
            "Sweet — this is exactly the use case Enterprise was built for. Three things to discuss:\n\n1. **Where to host**: self-host on your AWS, or wait for our hosted (Q3) — given fintech regulation, self-host is usually the call.\n\n2. **Migration of existing agents**: most teams have agents living in different frameworks (CrewAI, raw LangChain, custom). We have a 'workspace adapter' pattern that lets each team keep theirs while centralizing observability + cost caps.\n\n3. **GDPR/PII**: Colombian fintech regulation = data stays in-country. Self-host on AWS sa-east-1 (São Paulo) or local. We'll set up the Brain memory with `memoryLearningPaused=true` for PII conversations.\n\nWant a 30-min call with a solutions engineer this week? Mariana Cabrera (CSM Enterprise) can join.",
          tokens: 380,
        },
      ],
    },
    {
      agentId: A.multilingualSupport,
      channelId: C.whatsappLatam,
      customer: "Joaquín Vázquez",
      email: "joaquin@uy-startup.uy",
      status: "closed",
      tags: ["onboarding", "spanish"],
      csat: 5,
      hoursAgo: 19,
      messages: [
        { role: "user", content: "Recién instalé Orchester por docker, no me deja loguear" },
        {
          role: "assistant",
          content:
            "El primer login en self-host crea el admin user. Si no aparece la pantalla de signup, chequeá: (1) navegar a `/signup` directamente, (2) si volvés a `/login`, es porque `BETTER_AUTH_URL` apunta mal — en tu `.env` debe matchear EXACTO el host con el que entras (ej `http://localhost:3334`, no `127.0.0.1`).",
          tokens: 195,
        },
        { role: "user", content: "Era esa exacta cuestión 🙏" },
      ],
    },
    {
      agentId: A.itHelpdesk,
      channelId: C.slack,
      customer: "Lucía Pérez",
      email: "lucia@orchester.local",
      status: "closed",
      tags: ["mobile", "internal"],
      csat: 5,
      hoursAgo: 21,
      messages: [
        {
          role: "user",
          content: "el iPhone de trabajo no me recibe Slack notifs aunque tengo todo on",
        },
        {
          role: "assistant",
          content:
            "iOS focus modes son los típicos culpables. Settings → Focus → Work → Apps → asegurate de tener Slack como 'allowed'. También: Slack app → Preferences → Notifications → Mobile → Send notifications when on desktop ✓.",
          tokens: 130,
        },
        { role: "user", content: "era el focus mode, gracias" },
      ],
    },
    {
      agentId: A.brandVoice,
      channelId: C.api,
      customer: "Lucas Salgado",
      email: "luchi@orchester.local",
      status: "closed",
      tags: ["brand", "ads", "internal"],
      csat: 4,
      hoursAgo: 41,
      messages: [
        {
          role: "user",
          content:
            "LinkedIn ad copy: 'Orchester ayuda a desarrolladores a construir agentes IA increíbles con velocidad récord ⚡'",
        },
        {
          role: "assistant",
          content:
            'On-brand score: 28/100.\n- "increíbles", "velocidad récord", "⚡" — todos en la lista de "evitar".\n- "ayuda a construir" es genérico, dice cero del producto.\n- 0 claim verificable.\n\nVersión on-brand:\n> "Orchester: open-source platform para teams de AI agents. Multi-tenant, observable, cost-capped. Apache 2.0."\n\nO si querés más performance angle:\n> "Tu agente de IA tiene memoria, audit log y cost cap. En 2 horas, no en 2 semanas. Orchester (OSS)."\n\nLa 2da convierte mejor en LinkedIn dev audience.',
          tokens: 270,
        },
        { role: "user", content: "Voy con la 2da, gracias 🙌" },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Test Visitor 21",
      email: "visitor21@example.com",
      status: "closed",
      tags: ["spam"],
      hoursAgo: 220,
      messages: [
        { role: "user", content: "asdkfjhasldkfjh test test test" },
        { role: "assistant", content: "Looks like a test message. Closing.", tokens: 25 },
      ],
    },
    {
      agentId: A.multilingualSupport,
      channelId: C.web,
      customer: "Linnea Andersson",
      email: "linnea@sthlmstartup.se",
      status: "closed",
      tags: ["gdpr", "swedish"],
      csat: 5,
      hoursAgo: 53,
      messages: [
        { role: "user", content: "Är Orchester GDPR-kompatibel om vi self-hostar?" },
        {
          role: "assistant",
          content:
            "Ja. Self-hostad har du full kontroll över datalokalisering — välj EU-region för Postgres och du uppfyller dataresidenskravet automatiskt. Vi har också inbyggda funktioner: per-konversation 'memoryLearningPaused' för känsliga ämnen, audit logs, och kunde-data export endpoint. DPA-mall finns i docs/legal/dpa-template.md.",
          tokens: 240,
        },
        { role: "user", content: "Tack så mycket!" },
      ],
    },
    {
      agentId: A.tier1Support,
      channelId: C.web,
      customer: "Dev Trial 4421",
      email: "dev4421@example.com",
      status: "open",
      tags: ["bug", "investigating"],
      hoursAgo: 0.2,
      messages: [
        {
          role: "user",
          content: "flow_run logs are truncated at 2000 chars — how do I see the full?",
        },
        {
          role: "assistant",
          content:
            "Known limit in the inspector for performance. Full logs are persisted — you can fetch via API:\n\n```\nGET /api/v1/flow-runs/{run_id}/steps/{step_id}/logs?full=true\n```\n\nOr export the run as JSON from the inspector's '...' menu → 'Export run'. Fix to lift the inspector limit is in 0.2.3.",
          tokens: 175,
        },
      ],
    },
  ];

  for (const c of conversations) {
    const convId = createId();
    const startedAt = hoursAgo(c.hoursAgo);
    const endedAt = c.status === "closed" ? hoursAgo(Math.max(0, c.hoursAgo - 0.3)) : null;
    const totalTokens = c.messages.reduce((s, m) => s + (m.tokens ?? 0), 0);
    const totalCost = totalTokens * 0.000003; // ~$3 per million tokens, sonnet-ish

    // Summary = first user message, truncated. Visible in the Conversations
    // list column; without it the column shows "—" for every row.
    const firstUserMsg = c.messages.find((m) => m.role === "user")?.content ?? "";
    const summary = makeSummary(firstUserMsg);

    await db.insert(schema.conversations).values({
      id: convId,
      workspaceId: wsId,
      channelId: c.channelId,
      agentId: c.agentId,
      status: c.status,
      summary,
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

  // ── 8. Brain facts ────────────────────────────────────────────────────
  // Phase 3: brain facts seeding retired. The host no longer owns the
  // memory schema (mnemo_* tables moved to the @mnemosyne/server DB),
  // so seeding fact rows from here is a no-op. Mnemo seed data is
  // managed by the mnemosyne service itself.

  // ── 9. Flow runs + steps + webhooks + schedules ───────────────────────
  // The inspector panel reads flow_run_steps to render the per-node timeline.
  // The Triggers tab reads flow_webhooks + flow_schedules to render the
  // "Webhook URL" and "Cron" badges. Without them all three panels are empty.
  console.log("→ Creating flow runs + steps + webhooks + schedules…");

  const allFlows = await db
    .select({
      id: schema.flows.id,
      name: schema.flows.name,
      trigger: schema.flows.trigger,
      triggerConfig: schema.flows.triggerConfig,
      nodes: schema.flows.nodes,
    })
    .from(schema.flows)
    .where(eq(schema.flows.workspaceId, wsId));

  let runIndex = 0;
  let stepCount = 0;
  let webhookCount = 0;
  let scheduleCount = 0;
  for (const f of allFlows) {
    const flowNodes = (f.nodes ?? []) as Array<{ id: string; type: string; label?: string }>;

    // 2 runs per flow, varied statuses
    const statuses: ("succeeded" | "failed" | "running")[] =
      runIndex % 8 === 0
        ? ["succeeded", "failed"]
        : runIndex % 5 === 0
          ? ["succeeded", "running"]
          : ["succeeded", "succeeded"];
    for (let i = 0; i < statuses.length; i++) {
      const status = statuses[i]!;
      const startedAt = hoursAgo(2 + runIndex * 1.3);
      const completedAt =
        status === "running"
          ? null
          : new Date(startedAt.getTime() + (3000 + Math.floor(runIndex * 250)));
      const runId = createId();
      await db.insert(schema.flowRuns).values({
        id: runId,
        flowId: f.id,
        workspaceId: wsId,
        status,
        triggerSource:
          runIndex % 4 === 0 ? "schedule" : runIndex % 3 === 0 ? "manual:user_lucas" : "webhook",
        input: {
          email: `user${runIndex}@example.com`,
          source: runIndex % 2 === 0 ? "pricing-page" : "discussions",
        },
        output: status === "succeeded" ? { status: "ok", result: `Run ${runIndex}` } : null,
        error: status === "failed" ? "Provider timeout after 30s" : null,
        startedAt,
        completedAt,
      });

      // ── Per-step rows so the inspector timeline isn't empty ──────────
      // We walk the flow's nodes top-to-bottom; if status='failed', the LAST
      // step gets the error and earlier steps succeeded. If 'running', the
      // last step is still in-flight.
      let stepCursor = startedAt.getTime();
      for (let n = 0; n < flowNodes.length; n++) {
        const node = flowNodes[n]!;
        const isLast = n === flowNodes.length - 1;
        const stepStatus: "succeeded" | "failed" | "running" | "pending" =
          status === "failed" && isLast
            ? "failed"
            : status === "running" && isLast
              ? "running"
              : "succeeded";
        const dur = 200 + Math.floor((n * 137) % 1800); // 200ms–2s varied
        const stepStarted = new Date(stepCursor);
        const stepCompleted = stepStatus === "running" ? null : new Date(stepCursor + dur);
        stepCursor += dur + 80; // small inter-step gap
        await db.insert(schema.flowRunSteps).values({
          id: createId(),
          runId,
          nodeId: node.id,
          // Step node_type column must match the enum — we trust the flow def.
          nodeType: node.type as never,
          status: stepStatus,
          input: { _note: `${node.label ?? node.type} input`, ix: n },
          output:
            stepStatus === "succeeded"
              ? { _note: `${node.label ?? node.type} output`, ok: true, ix: n }
              : null,
          error: stepStatus === "failed" ? "Provider timeout after 30s" : null,
          startedAt: stepStarted,
          completedAt: stepCompleted,
        });
        stepCount++;
        if (stepStatus !== "succeeded") break;
      }

      runIndex++;
    }

    // ── flow_webhook (if webhook/conversation trigger) ──────────────────
    if (f.trigger === "webhook" || f.trigger === "conversation") {
      await db.insert(schema.flowWebhooks).values({
        id: createId(),
        flowId: f.id,
        workspaceId: wsId,
        secret: "whk_" + createId().slice(0, 22),
        hmacKey: "hmac_" + createId().slice(0, 28),
        enabled: true,
        triggerCount: 50 + ((webhookCount * 137) % 4000),
        lastTriggeredAt: hoursAgo(Math.max(0.5, (webhookCount * 1.7) % 48)),
      });
      webhookCount++;
    }

    // ── flow_schedule (if schedule trigger) ─────────────────────────────
    if (f.trigger === "schedule") {
      const cfg = (f.triggerConfig ?? {}) as { cron?: string; timezone?: string };
      await db.insert(schema.flowSchedules).values({
        id: createId(),
        flowId: f.id,
        workspaceId: wsId,
        cron: cfg.cron ?? "0 9 * * MON",
        timezone: cfg.timezone ?? "America/Argentina/Buenos_Aires",
        enabled: true,
        lastRunAt: hoursAgo(8 + scheduleCount * 2),
        nextRunAt: new Date(Date.now() + (24 - scheduleCount) * 3600 * 1000),
      });
      scheduleCount++;
    }
  }

  // ── Wire real public PDF URLs to matching KB doc titles ───────────────
  // These are stable upstream sources — clicking a doc in the Studio surfaces
  // a real download instead of a dead "—". No API key needed, no LLM hit;
  // it's just a URL string stored on the row.
  const docUrlByTitle: Record<string, string> = {
    "API Reference v0.2":
      "https://www.postgresql.org/files/documentation/pdf/16/postgresql-16-A4.pdf",
    "Multi-tenancy Architecture":
      "https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models",
    "MCP Server — stdio + HTTP":
      "https://modelcontextprotocol.io/specification/2025-06-18/index.md",
    "Brain Memory System Overview": "https://arxiv.org/pdf/2402.13116.pdf",
    "Data Processing Addendum (DPA) — EU":
      "https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32016R0679",
    "Política de Privacidad v3.1":
      "https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32016R0679",
    "Terms of Service v2.4": "https://www.apache.org/licenses/LICENSE-2.0.txt",
    "SOC2 Type II — Controls Matrix":
      "https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2",
    "Encryption at Rest & In Transit": "https://datatracker.ietf.org/doc/html/rfc8446",
    "Accessibility Checklist (WCAG 2.2 AA)": "https://www.w3.org/TR/WCAG22/",
    "ADR 001 — Postgres + pgvector": "https://github.com/pgvector/pgvector/blob/master/README.md",
    "ADR 014 — Mnemosyne memory model": "https://arxiv.org/pdf/2310.02071.pdf",
    "Testing Strategy (unit/integration/e2e)":
      "https://martinfowler.com/articles/practical-test-pyramid.html",
    "Code of Conduct": "https://www.contributor-covenant.org/version/2/1/code_of_conduct/",
    "Battle Card vs LangGraph": "https://langchain-ai.github.io/langgraph/concepts/high_level/",
    "Battle Card vs CrewAI / AutoGen":
      "https://microsoft.github.io/autogen/0.2/docs/Getting-Started/",
  };
  for (const [title, url] of Object.entries(docUrlByTitle)) {
    await db
      .update(schema.knowledgeDocs)
      .set({ url })
      .where(
        and(eq(schema.knowledgeDocs.workspaceId, wsId), eq(schema.knowledgeDocs.title, title))
      );
  }

  // ── 10. Knowledge chunks — text only, no embeddings ────────────────────
  // Doc detail UI shows a chunks preview list. Without rows, the panel is
  // a "no chunks" empty state. We seed plausible text per doc title so the
  // preview reads naturally. Embedding column stays NULL — RAG won't return
  // these, by design (per the comment higher in this file).
  console.log("→ Creating knowledge chunks (text-only, no embeddings)…");
  const allDocs = await db
    .select({
      id: schema.knowledgeDocs.id,
      kbId: schema.knowledgeDocs.kbId,
      title: schema.knowledgeDocs.title,
      status: schema.knowledgeDocs.status,
      chunkCount: schema.knowledgeDocs.chunkCount,
    })
    .from(schema.knowledgeDocs)
    .where(eq(schema.knowledgeDocs.workspaceId, wsId));

  const sampleChunkTexts = [
    "Overview. This document describes the architecture and conventions used in production. Read this before changing any of the public APIs.",
    "Setup. Install the prerequisites listed below. The minimum supported Node version is 22 LTS; older versions will fail the postinstall check.",
    "Configuration. Environment variables are documented in `.env.example`. All keys are required at boot except those flagged 'optional'.",
    "Architecture. The system is partitioned by workspace_id. There is no cross-workspace read path; tests assert this at the RLS layer.",
    "API contract. Endpoints follow REST conventions. Pagination uses cursor-based offsets via the `?after=<cursor>` query parameter.",
    "Error handling. Errors return a JSON envelope `{ code, message, requestId }`. Never throw raw strings; consumers depend on `code`.",
    "Security. All routes that mutate state require workspace ownership assertion. The pattern is `assertOwnership(agent, session.workspaceId)`.",
    "Performance. Hot-path queries hit pre-computed materialized views. Refresh cadence is 5 minutes; staleness is acceptable per spec.",
    "Migration. Database migrations are forward-only. Every migration ships with a `.down.sql` that's tested in CI but never auto-applied.",
    "Glossary. Activation = signup → connect provider → create agent → run agent, within 7 days. NRR = (start MRR + expansion − churn) / start MRR.",
  ];
  let chunkCountTotal = 0;
  for (const d of allDocs) {
    if (d.status !== "ready") continue;
    // 5 representative chunks per ready doc — the real chunkCount stays as
    // set on the doc row (we're not pretending these are exhaustive).
    for (let ord = 0; ord < 5; ord++) {
      const txt = sampleChunkTexts[ord]!.replace("This document", `"${d.title}"`);
      await db.insert(schema.knowledgeChunks).values({
        id: createId(),
        docId: d.id,
        kbId: d.kbId,
        workspaceId: wsId,
        ordinal: ord,
        text: txt,
        metadata: { page: ord + 1, section: ["intro", "setup", "api", "ops", "glossary"][ord] },
      });
      chunkCountTotal++;
    }
  }

  // ── 11. Conversation labels (custom Studio tags) ───────────────────────
  console.log("→ Creating conversation labels…");
  await db.insert(schema.conversationLabels).values([
    { id: createId(), workspaceId: wsId, name: "VIP", color: "#a78bfa" },
    { id: createId(), workspaceId: wsId, name: "Enterprise", color: "#22d3ee" },
    { id: createId(), workspaceId: wsId, name: "Bug-report", color: "#f87171" },
    { id: createId(), workspaceId: wsId, name: "Feature-request", color: "#facc15" },
    { id: createId(), workspaceId: wsId, name: "Churn-risk", color: "#ef4444" },
    { id: createId(), workspaceId: wsId, name: "Upsell", color: "#34d399" },
    { id: createId(), workspaceId: wsId, name: "Onboarding", color: "#60a5fa" },
    { id: createId(), workspaceId: wsId, name: "Press", color: "#fb7185" },
    { id: createId(), workspaceId: wsId, name: "Internal", color: "#94a3b8" },
    { id: createId(), workspaceId: wsId, name: "Demo-requested", color: "#a3e635" },
  ]);

  // ── 11b. AI providers — populate without overwriting real keys ────────
  // If the user already connected OpenAI through the Studio (encrypted
  // `api_key` is real), we DO NOT touch the key. We only enrich `models_json`
  // and the test status so the Providers tab renders the model catalog and a
  // healthy badge. Other providers are seeded as DRAFT (enabled=false) with
  // a placeholder key — the app should never attempt decryption while
  // enabled=false; these rows exist purely to populate the tab UI.
  console.log("→ Enriching AI providers…");
  const openaiModels = [
    { id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, tier: "powerful" as const },
    { id: "gpt-4o-mini", name: "GPT-4o mini", contextWindow: 128000, tier: "fast" as const },
    { id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1000000, tier: "powerful" as const },
    { id: "gpt-4.1-mini", name: "GPT-4.1 mini", contextWindow: 1000000, tier: "smart" as const },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo", contextWindow: 128000, tier: "smart" as const },
    { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", contextWindow: 16385, tier: "fast" as const },
    { id: "o1", name: "o1 (reasoning)", contextWindow: 200000, tier: "powerful" as const },
    { id: "o1-mini", name: "o1-mini", contextWindow: 128000, tier: "smart" as const },
    {
      id: "text-embedding-3-small",
      name: "Embedding 3 small",
      contextWindow: 8192,
      tier: "fast" as const,
    },
    {
      id: "text-embedding-3-large",
      name: "Embedding 3 large",
      contextWindow: 8192,
      tier: "smart" as const,
    },
  ];
  const anthropicModels = [
    {
      id: "claude-opus-4-7",
      name: "Claude Opus 4.7",
      contextWindow: 200000,
      tier: "powerful" as const,
    },
    {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      contextWindow: 200000,
      tier: "smart" as const,
    },
    {
      id: "claude-haiku-4-5",
      name: "Claude Haiku 4.5",
      contextWindow: 200000,
      tier: "fast" as const,
    },
  ];
  const googleModels = [
    {
      id: "gemini-2.0-pro",
      name: "Gemini 2.0 Pro",
      contextWindow: 1000000,
      tier: "powerful" as const,
    },
    {
      id: "gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      contextWindow: 1000000,
      tier: "smart" as const,
    },
    {
      id: "gemini-2.0-flash-lite",
      name: "Gemini 2.0 Flash Lite",
      contextWindow: 1000000,
      tier: "fast" as const,
    },
  ];

  // Upsert OpenAI: don't overwrite api_key if a row already exists.
  const existingOpenai = await db
    .select({ id: schema.aiProviders.id })
    .from(schema.aiProviders)
    .where(and(eq(schema.aiProviders.workspaceId, wsId), eq(schema.aiProviders.provider, "openai")))
    .limit(1);
  if (existingOpenai[0]) {
    await db
      .update(schema.aiProviders)
      .set({
        modelsJson: openaiModels,
        enabled: true,
        lastTestedAt: hoursAgo(2),
        lastTestStatus: "ok",
        lastTestError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.aiProviders.id, existingOpenai[0].id));
  } else {
    await db.insert(schema.aiProviders).values({
      id: createId(),
      workspaceId: wsId,
      provider: "openai",
      apiKey: "demo:placeholder:not-real",
      enabled: false,
      modelsJson: openaiModels,
      lastTestedAt: hoursAgo(2),
      lastTestStatus: "not_tested",
    });
  }

  // Anthropic + Google as draft rows (don't overwrite if already there).
  for (const { provider, models, status } of [
    { provider: "anthropic", models: anthropicModels, status: "ok" },
    { provider: "google", models: googleModels, status: "not_tested" },
  ] as const) {
    const existing = await db
      .select({ id: schema.aiProviders.id })
      .from(schema.aiProviders)
      .where(
        and(eq(schema.aiProviders.workspaceId, wsId), eq(schema.aiProviders.provider, provider))
      )
      .limit(1);
    if (existing[0]) {
      await db
        .update(schema.aiProviders)
        .set({
          modelsJson: models,
          lastTestedAt: hoursAgo(provider === "anthropic" ? 4 : 168),
          lastTestStatus: status,
          updatedAt: new Date(),
        })
        .where(eq(schema.aiProviders.id, existing[0].id));
    } else {
      await db.insert(schema.aiProviders).values({
        id: createId(),
        workspaceId: wsId,
        provider,
        // Draft placeholder — never decrypted because enabled=false
        apiKey: "demo:placeholder:not-real",
        enabled: false,
        modelsJson: models,
        lastTestedAt: hoursAgo(provider === "anthropic" ? 4 : 168),
        lastTestStatus: status,
      });
    }
  }

  // ── 11c. Agent versions — prompt history for the "Versions" tab ─────────
  // Each agent gets 2-3 historical snapshots, so the Agent detail UI shows
  // a non-trivial revision log instead of "v1 only".
  console.log("→ Creating agent version history…");
  const agentsForVersions = await db
    .select({
      id: schema.agents.id,
      systemPrompt: schema.agents.systemPrompt,
      model: schema.agents.model,
      temperature: schema.agents.temperature,
      maxTokens: schema.agents.maxTokens,
    })
    .from(schema.agents)
    .where(eq(schema.agents.workspaceId, wsId));
  let agentVersionCount = 0;
  for (const a of agentsForVersions) {
    // v1 — earlier prompt (a leaner version of the current one)
    const v1Prompt = a.systemPrompt.slice(0, Math.max(40, Math.floor(a.systemPrompt.length * 0.6)));
    await db.insert(schema.agentVersions).values({
      id: createId(),
      agentId: a.id,
      workspaceId: wsId,
      systemPrompt: v1Prompt + "\n\n[earlier iteration]",
      model: "claude-sonnet-4-5",
      temperature: "0.7",
      maxTokens: a.maxTokens,
      label: "v1 — initial",
      createdAt: daysAgo(45),
    });
    agentVersionCount++;
    // v2 — improved phrasing
    await db.insert(schema.agentVersions).values({
      id: createId(),
      agentId: a.id,
      workspaceId: wsId,
      systemPrompt: a.systemPrompt + "\n\n[+ examples added in v2]",
      model: a.model,
      temperature: a.temperature ?? "0.7",
      maxTokens: a.maxTokens,
      label: "v2 — added few-shot examples",
      createdAt: daysAgo(20),
    });
    agentVersionCount++;
    // v3 — current (only for ~half of agents to keep variety)
    if (agentVersionCount % 2 === 0) {
      await db.insert(schema.agentVersions).values({
        id: createId(),
        agentId: a.id,
        workspaceId: wsId,
        systemPrompt: a.systemPrompt,
        model: a.model,
        temperature: a.temperature ?? "0.7",
        maxTokens: a.maxTokens,
        label: "v3 — current",
        createdAt: daysAgo(3),
      });
      agentVersionCount++;
    }
  }

  // ── 11d. Flow versions — DAG snapshots for the "Versions" tab ──────────
  console.log("→ Creating flow version history…");
  const flowsForVersions = await db
    .select({
      id: schema.flows.id,
      nodes: schema.flows.nodes,
      edges: schema.flows.edges,
      variables: schema.flows.variables,
    })
    .from(schema.flows)
    .where(eq(schema.flows.workspaceId, wsId));
  let flowVersionCount = 0;
  for (const f of flowsForVersions) {
    // v1 — simpler version (drop the last node so the diff is meaningful)
    const v1Nodes = (f.nodes ?? []).slice(0, Math.max(2, (f.nodes ?? []).length - 1));
    const v1NodeIds = new Set(v1Nodes.map((n) => n.id));
    const v1Edges = (f.edges ?? []).filter(
      (e) => v1NodeIds.has(e.source) && v1NodeIds.has(e.target)
    );
    await db.insert(schema.flowVersions).values({
      id: createId(),
      flowId: f.id,
      workspaceId: wsId,
      version: 1,
      label: "v1 — initial draft",
      nodes: v1Nodes,
      edges: v1Edges,
      variables: f.variables ?? {},
      createdAt: daysAgo(30),
    });
    flowVersionCount++;
    // v2 — current snapshot
    await db.insert(schema.flowVersions).values({
      id: createId(),
      flowId: f.id,
      workspaceId: wsId,
      version: 2,
      label: "v2 — current",
      nodes: f.nodes ?? [],
      edges: f.edges ?? [],
      variables: f.variables ?? {},
      createdAt: daysAgo(7),
    });
    flowVersionCount++;
  }

  // ── 12. Audit log — recent activity feed ───────────────────────────────
  // Chain hash is non-null because the table marks it NOT NULL. For a seed
  // we don't link rows cryptographically; we generate independent random
  // hex strings so the hashes column has the right shape.
  console.log("→ Creating audit log entries…");
  const hex = () => Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[(i * 7) % 16]).join("");
  type AuditEvent = {
    action: string;
    targetType: string;
    targetId: string;
    hoursAgo: number;
    actorKind?: string;
    meta?: Record<string, unknown>;
  };
  const auditEvents: AuditEvent[] = [
    { action: "agent.created", targetType: "agent", targetId: A.leadQualifier, hoursAgo: 168 },
    {
      action: "agent.updated",
      targetType: "agent",
      targetId: A.salesCoach,
      hoursAgo: 144,
      meta: { fields: ["systemPrompt"] },
    },
    {
      action: "agent.deployed",
      targetType: "agent",
      targetId: A.multilingualSupport,
      hoursAgo: 90,
    },
    {
      action: "agent.deleted",
      targetType: "agent",
      targetId: "agent_archived_demo",
      hoursAgo: 80,
      meta: { name: "Old PTO bot (v1)" },
    },
    { action: "flow.created", targetType: "flow", targetId: "flow_lead_qual_demo", hoursAgo: 72 },
    { action: "flow.published", targetType: "flow", targetId: "flow_pto_demo", hoursAgo: 60 },
    { action: "flow.paused", targetType: "flow", targetId: "flow_legacy_demo", hoursAgo: 48 },
    {
      action: "channel.connected",
      targetType: "channel",
      targetId: "channel_slack_eng_demo",
      hoursAgo: 36,
      meta: { type: "slack" },
    },
    {
      action: "channel.disconnected",
      targetType: "channel",
      targetId: "channel_partner_api_demo",
      hoursAgo: 30,
    },
    {
      action: "knowledge_base.created",
      targetType: "knowledge_base",
      targetId: KB.engineering,
      hoursAgo: 26,
    },
    {
      action: "knowledge_doc.uploaded",
      targetType: "knowledge_doc",
      targetId: "doc_msa_demo",
      hoursAgo: 22,
      meta: { title: "MSA Template v3.docx", size_kb: 240 },
    },
    {
      action: "knowledge_doc.failed",
      targetType: "knowledge_doc",
      targetId: "doc_failed_demo",
      hoursAgo: 20,
      meta: { error: "PDF parser timeout (file > 50MB)" },
    },
    { action: "team.created", targetType: "team", targetId: T.engineering, hoursAgo: 168 },
    {
      action: "team.renamed",
      targetType: "team",
      targetId: T.customerSuccess,
      hoursAgo: 96,
      meta: { from: "CSM Squad", to: "Customer Success" },
    },
    {
      action: "employee.added",
      targetType: "employee",
      targetId: "emp_new_demo",
      hoursAgo: 18,
      meta: { name: "Camila Ñañez" },
    },
    {
      action: "employee.deactivated",
      targetType: "employee",
      targetId: "emp_departed_demo",
      hoursAgo: 14,
    },
    {
      action: "workspace.settings_updated",
      targetType: "workspace",
      targetId: wsId,
      hoursAgo: 12,
      meta: { keys: ["costCapMonthlyUsd"] },
    },
    {
      action: "workspace.member_invited",
      targetType: "user",
      targetId: "user_invite_demo",
      hoursAgo: 10,
      meta: { email: "newhire@orchester.local", role: "member" },
    },
    {
      action: "workspace.member_role_changed",
      targetType: "user",
      targetId: "user_perm_demo",
      hoursAgo: 8,
      meta: { from: "member", to: "admin" },
    },
    {
      action: "billing.plan_changed",
      targetType: "workspace",
      targetId: wsId,
      hoursAgo: 7,
      meta: { from: "team", to: "enterprise" },
    },
    {
      action: "provider.connected",
      targetType: "ai_provider",
      targetId: "prov_anthropic_demo",
      hoursAgo: 6,
      meta: { provider: "anthropic" },
    },
    {
      action: "provider.key_rotated",
      targetType: "ai_provider",
      targetId: "prov_openai_demo",
      hoursAgo: 5,
      meta: { provider: "openai" },
    },
    {
      action: "flow.run_completed",
      targetType: "flow_run",
      targetId: "run_demo_1",
      hoursAgo: 2.5,
      meta: { status: "succeeded", durationMs: 4320 },
    },
    {
      action: "flow.run_failed",
      targetType: "flow_run",
      targetId: "run_demo_2",
      hoursAgo: 2,
      meta: { error: "Provider timeout after 30s" },
    },
    {
      action: "conversation.taken_over",
      targetType: "conversation",
      targetId: "conv_takeover_demo",
      hoursAgo: 1.5,
      meta: { by: "lucia@orchester.local" },
    },
    {
      action: "audit.export_requested",
      targetType: "workspace",
      targetId: wsId,
      hoursAgo: 1,
      actorKind: "system",
      meta: { format: "csv", days: 30 },
    },
    { action: "auth.login", targetType: "user", targetId: "user_lucas_demo", hoursAgo: 0.5 },
    { action: "auth.api_key_created", targetType: "api_key", targetId: "key_demo", hoursAgo: 0.25 },
  ];

  // BIGINT seq counter per workspace. Real audit log writes increment this
  // monotonically; we just hand-number for the seed.
  for (let i = 0; i < auditEvents.length; i++) {
    const e = auditEvents[i]!;
    await db.insert(schema.auditLog).values({
      id: createId(),
      workspaceId: wsId,
      seq: BigInt(i + 1),
      prevHash: i === 0 ? null : hex(),
      payloadHash: hex(),
      chainHash: hex(),
      action: e.action,
      actorUserId: null,
      actorKind: e.actorKind ?? "user",
      actorUserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      targetType: e.targetType,
      targetId: e.targetId,
      meta: e.meta ?? {},
      createdAt: hoursAgo(e.hoursAgo),
    });
  }

  // ── Done ───────────────────────────────────────────────────────────────
  console.log("");
  console.log("✓ Demo seed complete:");
  console.log("  • 12 teams (organigrama 360°)");
  console.log("  • 56 employees with avatars + manager hierarchy");
  console.log("  • 38 agents (conversational + flow) with Dicebear avatars");
  console.log("  • 10 knowledge bases with 48 doc rows + KB chunks");
  console.log("  • 16 production-grade flows with multi-node DAGs");
  console.log(`  • ${webhookCount} flow_webhooks + ${scheduleCount} flow_schedules`);
  console.log(
    "  • 12 channels (web + widget + slack ×3 + telegram + whatsapp ×2 + email + api ×3)"
  );
  console.log("  • ~75 realistic conversations with summaries + CSAT");
  console.log("  • 50 brain facts (workspace + agent + conversation scoped)");
  console.log(`  • ${runIndex} flow runs + ${stepCount} flow_run_steps (inspector mockup)`);
  console.log(`  • ${chunkCountTotal} knowledge chunks (doc detail preview)`);
  console.log("  • 10 conversation labels");
  console.log("  • 3 ai_providers (openai active, anthropic + google drafts)");
  console.log(`  • ${agentVersionCount} agent_versions + ${flowVersionCount} flow_versions`);
  console.log(`  • ${auditEvents.length} audit log entries (activity feed)`);
  console.log("");
  console.log("→ Abrí el studio y mostrá tu producto.");
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
  await db.delete(schema.conversationLabels).where(eq(schema.conversationLabels.workspaceId, wsId));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.workspaceId, wsId));
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
