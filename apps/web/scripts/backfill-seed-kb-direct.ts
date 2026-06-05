/// <reference types="node" />
/**
 * Backfill seed KBs with REAL embeddings — direct DB writes, no HTTP.
 *
 * Why a second script?
 *
 * `backfill-seed-kb.ts` uploads through POST /api/knowledge-bases/[id]/docs,
 * which uses session-cookie auth — fine for an interactive workflow, awkward
 * for a one-shot seed pass. This version reads the SEED_DOCS list and writes
 * straight to the database after computing real OpenAI embeddings, so it
 * works headless with just DATABASE_URL + ENCRYPTION_SECRET + a connected
 * provider (the encrypted api_key already sits on `ai_provider`).
 *
 * Usage:
 *
 *   DATABASE_URL=postgres://… \
 *   ENCRYPTION_SECRET=… \
 *   pnpm tsx apps/web/scripts/backfill-seed-kb-direct.ts \
 *     --workspace-slug acme-inc
 *
 * Skips docs whose title already exists with `status='ready'` and a non-zero
 * `chunk_count`. Safe to re-run. Cost ≈ <$0.001 (text-embedding-3-small on
 * ~80 chunks).
 */

import crypto from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";

// ─── Inlined: AES-256-GCM decrypt (mirrors apps/web/lib/encryption.ts) ───
// We can't `import` from lib/ because lib/embeddings.ts pulls "server-only"
// which throws outside the Next runtime. The amount of code we need is tiny;
// inlining keeps the script standalone.
const VERSION_PREFIX_RE = /^v(\d+):/;
function deriveKey(secret: string): Buffer {
  if (secret.length !== 64) {
    throw new Error(`ENCRYPTION_SECRET must be 32-byte hex (64 chars). Got ${secret.length}`);
  }
  return Buffer.from(secret, "hex");
}
let cachedKey: Buffer | null = null;
function decrypt(encoded: string): string {
  if (!cachedKey) {
    const s = process.env.ENCRYPTION_SECRET;
    if (!s) throw new Error("ENCRYPTION_SECRET required");
    cachedKey = deriveKey(s);
  }
  const m = VERSION_PREFIX_RE.exec(encoded);
  const body = m ? encoded.slice(m[0].length) : encoded;
  const [ivB64, tagB64, ctB64] = body.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Invalid ciphertext");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", cachedKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

// ─── Inlined: chunkText (mirrors apps/web/lib/chunking.ts) ───
function chunkText(text: string, chunkSize = 800, chunkOverlap = 100): string[] {
  if (!text.trim()) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+|\n\n+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buffer = "";
  for (const s of sentences) {
    if (s.length > chunkSize) {
      if (buffer) {
        chunks.push(buffer);
        buffer = buffer.slice(-chunkOverlap);
      }
      let i = 0;
      while (i < s.length) {
        chunks.push(s.slice(i, i + chunkSize));
        i += chunkSize - chunkOverlap;
      }
      continue;
    }
    if ((buffer + " " + s).length > chunkSize) {
      chunks.push(buffer);
      buffer = buffer.slice(-chunkOverlap) + " " + s;
    } else {
      buffer = buffer ? buffer + " " + s : s;
    }
  }
  if (buffer.trim()) chunks.push(buffer);
  return chunks;
}

// ─── OpenAI embeddings call (direct fetch, no SDK) ───
async function embedOpenAI(
  apiKey: string,
  model: string,
  texts: string[]
): Promise<{ vectors: number[][]; tokensUsed: number }> {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as {
    data: Array<{ embedding: number[] }>;
    usage?: { total_tokens?: number };
  };
  // text-embedding-3-small is already 1536-dim, matching our schema. Larger
  // models would need normalizeTo1536 — out of scope for this script.
  return {
    vectors: j.data.map((d) => d.embedding),
    tokensUsed: j.usage?.total_tokens ?? 0,
  };
}

interface Args {
  workspaceSlug: string;
}

function parseArgs(): Args {
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    const next = process.argv[i + 1];
    if (arg === "--workspace-slug" && next) {
      return { workspaceSlug: next };
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: tsx apps/web/scripts/backfill-seed-kb-direct.ts --workspace-slug <slug>");
      process.exit(0);
    }
  }
  console.error("Missing --workspace-slug. Run with --help.");
  process.exit(2);
}

interface SeedDoc {
  kbName: string;
  title: string;
  content: string;
}

// Curated set across the 10 seed KBs. Real text → real chunks → real embeddings.
const SEED_DOCS: SeedDoc[] = [
  // ── Product Docs ────────────────────────────────────────────────────────
  {
    kbName: "Product Docs",
    title: "Getting Started.md",
    content: `# Getting Started with Orchester

Orchester is an open-source AI agent platform. Build teams of agents that share knowledge, route work via flows, and answer across every channel — without you wiring it up.

## 1. Create an agent
Agents → "+ New Agent". Pick a model, paste a system prompt, save. The agent is live within seconds.

## 2. Connect a channel
Web widget, WhatsApp, Telegram, Slack, email, or HTTP API. Each channel binds to one agent.

## 3. Build a flow (optional)
For multi-step automations: trigger → KB search → agent → conditional → action. Each step is observable.

## 4. Add knowledge
Knowledge → "+ New base" creates a pgvector-backed index. Upload PDFs, paste text, or import URLs.

## 5. Inspect the run
Click any conversation or flow run to see inputs, outputs, costs, and brain memory recalls — top to bottom.`,
  },
  {
    kbName: "Product Docs",
    title: "API Reference v0.2.md",
    content: `# Orchester API v0.2

Base URL: \`http://localhost:3334/api\` (dev) or \`https://api.orchester.io/v1\` (cloud).

## Auth
Bearer tokens from Settings → Developers. Format: \`ok_live_…\`. Workspace-scoped.

## Endpoints
- \`GET /agents\` — list agents
- \`POST /agents\` — create
- \`GET /flows/:id/runs\` — list runs
- \`POST /flows/:id/runs\` — trigger
- \`POST /conversations/:id/messages\` — append inbound message
- \`POST /knowledge-bases/:id/docs\` — upload doc (text | url | file)
- \`GET /knowledge-bases/:id/search?q=…\` — semantic search
- \`POST /mcp\` — JSON-RPC 2.0 MCP endpoint

## Rate limits
60 req/min/workspace by default. Bursts to 100. 429 on overflow.`,
  },
  {
    kbName: "Product Docs",
    title: "Brain Memory System Overview.md",
    content: `# The Brain — agent memory that survives context windows

Every agent has access to a tenant-isolated fact store. Facts are extracted from conversations, embedded via pgvector, and recalled on subsequent turns.

## Scopes
- \`global\` — workspace-wide preferences (writing style, banned words, deployment region).
- \`conversation\` — scoped to a single chat (a prospect's MEDDIC notes).
- \`team\` — shared across all agents on a team.

## Confidence + relevance
Each fact has a confidence (0–1) from extraction, and a relevance score that decays without recalls. Pinned facts skip decay.

## Inspectable
The Brain tab lets operators see, edit, pin, or archive any fact. Required for GDPR.`,
  },
  // ── HR Policies ─────────────────────────────────────────────────────────
  {
    kbName: "HR Policies",
    title: "Política de Vacaciones y Licencias.md",
    content: `# Política de Vacaciones 2026 — Acme Inc.

## Allotment anual
20 días hábiles por año. Acumulan mensualmente (1.67 días/mes). Disponibles luego de 90 días de antigüedad.

## Carry-over
Hasta 5 días no usados se trasladan al año siguiente. Deben usarse antes del 31 de marzo o expiran.

## Solicitud
Pedir via Settings → My account → Time off, con al menos 2 semanas de anticipación para 3+ días. Auto-aprobación: ≤5 días + >14 días de aviso + balance suficiente.

## Licencia parental
16 semanas pagas para el padre/madre gestante, 8 semanas para el no-gestante. Aplicables dentro de los 12 meses del nacimiento o adopción.

## Owner
Florencia Castro (Head of People), florencia@orchester.local.`,
  },
  {
    kbName: "HR Policies",
    title: "Código de Conducta.md",
    content: `# Código de Conducta — Acme Inc.

## 1. Respeto
Tolerancia cero a discriminación, acoso, o conducta hostil. Reportes anónimos via ethics-hotline.acme.com.

## 2. Confidencialidad
Datos de clientes, financials, y planes no lanzados son confidenciales. No compartir screenshots de dashboards en Slack público.

## 3. Horas
Async-first. Overlap core 10:00–14:00 ART. Medimos outcomes, no horas.

## 4. Uso de IA
Pueden usar Claude / Cursor libremente para trabajo interno. Datos de clientes NUNCA salen de Orchester ni van a ChatGPT personal.

## 5. Open source
Engineers pueden contribuir a OSS en horario laboral con aprobación de su lead.

## Reporte de violaciones
people@orchester.local o cualquier C-level. Sin retaliación.`,
  },
  // ── IT Runbook ──────────────────────────────────────────────────────────
  {
    kbName: "IT Runbook",
    title: "VPN Troubleshooting (WireGuard).md",
    content: `# VPN Troubleshooting (WireGuard)

Orchester's internal VPN runs on WireGuard. Common issues:

## "Authentication failed"
1. Tu password de AD probablemente expiró — chequeá en accounts.orchester.local.
2. Si lo cambiaste hoy, esperá 5 min para que sincronice con LDAP.
3. Reabrí el cliente WireGuard.

## "Handshake did not complete"
1. \`sudo wg show\` — confirma handshake reciente (<2 min).
2. Si tu red home tiene rango 10.10.x.x, hay conflicto. Mové el router a 192.168.x.x o contactá Nico Ríos.
3. En firewalls restrictivos (hotel, aeropuerto), cambiá al fallback TCP 443.

## DNS no resuelve interno
- macOS: \`sudo killall -HUP mDNSResponder\`
- Linux: \`sudo systemd-resolve --flush-caches\`
- Verificar con \`dig internal.orchester.local @10.10.0.1\`.

## Sigue roto
Slack #it-help con: OS+version, output de \`wg show\`, y traceroute a internal.orchester.local. SLA 4 hs hábiles.`,
  },
  {
    kbName: "IT Runbook",
    title: "Incident Response Playbook (P0/P1).md",
    content: `# Incident Response Playbook (P0/P1)

P0 = customer-impacting outage. P1 = major degradation. Page on-call via PagerDuty.

## 1. Mitigate first
Always mitigate BEFORE you investigate root cause. Options:
- Rollback to previous deploy: \`vercel rollback --to=prev\`.
- Kill stuck migration: \`migration-kill <id>\` via SSH to flow-runner.
- Failover Postgres to read replica if primary degraded.

## 2. Status updates
First update within 15 min of detection. Subsequent every 30 min on status.orchester.io. Template:
> "Investigating elevated error rates on [scope]. ETA next update: HH:MM UTC."

## 3. Postmortem
Within 48hs of resolution. Use the template at docs/postmortems. CC eng-leadership@orchester.local.

## 4. Comms
Customer-facing: support team drafts, CSM reviews, you approve.
Internal: post in #incidents with running thread.`,
  },
  // ── Brand Voice ─────────────────────────────────────────────────────────
  {
    kbName: "Brand Voice Guide",
    title: "Brand Voice & Tone Guide.md",
    content: `# Brand Voice & Tone

## Three adjectives
- **Direct.** Say what you mean. Don't bury the point.
- **Technical-but-accessible.** Specific enough for engineers, no jargon walls for execs.
- **Dry, occasional humor.** Never hyperbolic.

## Banned words
revolutionary, game-changing, cutting-edge, unlock(ing), disrupt(ing), AI-powered, next-generation, seamlessly, effortlessly, robust, enterprise-grade, best-in-class.

## Do
- Start with the answer.
- Use contractions (you're, we'll).
- Second person ("you can") in product copy; first-person plural ("we built") in marketing.
- Active voice, present tense.

## Don't
- Emoji in error messages.
- All-caps for emphasis (use bold).
- Pre-apologize for things that aren't your fault.

## Error message pattern
1. State what failed (specific).
2. State why (if you know).
3. State what the user can do.

❌ "Something went wrong."
✅ "Couldn't save the agent — name is required. Add a name and try again."`,
  },
  // ── Engineering Wiki ────────────────────────────────────────────────────
  {
    kbName: "Engineering Wiki",
    title: "ADR 001 — Postgres + pgvector.md",
    content: `# ADR 001 — Postgres + pgvector for vector search

## Status
Accepted, 2026-Q1.

## Context
We need vector search for KB RAG and brain fact recall. Options considered: Pinecone (managed), Weaviate (self-host), Qdrant (self-host), pgvector (extension on existing Postgres).

## Decision
Use pgvector. Reasons:
- Already run Postgres for OLTP. No new operational surface.
- Multi-tenancy via workspace_id columns + RLS — same model as everything else.
- pgvector + HNSW indexes hit ~10ms p95 for 100K vectors in our tests.
- Backups, PITR, replication, transactions — all free from Postgres.

## Consequences
- We're capped at vector(1536) dimensions — chosen to match OpenAI text-embedding-3-small. Larger embeddings (3-large) get truncated.
- Approx-nearest only on HNSW indexes. We're fine with this for RAG.
- pgvector extension must be enabled on every database (including dev, staging, prod, prod-replica). Docker images: \`pgvector/pgvector:pg16\`.

## Alternatives rejected
- Pinecone: managed cost + vendor lock-in + cross-region data residency complications.
- Weaviate/Qdrant: extra service to operate. No clear quality win for our scale.`,
  },
  {
    kbName: "Engineering Wiki",
    title: "Testing Strategy.md",
    content: `# Testing Strategy

## Pyramid
- Unit (Vitest): 70% of tests. Pure functions, no DB.
- Integration (Vitest + testcontainers Postgres): 25%. DB queries, RLS assertions.
- E2E (Playwright): 5%. Critical user flows only — auth, agent CRUD, KB upload.

## Required tests per change
- Every new endpoint: 1 happy-path + 1 auth-failure test.
- Every new flow node type: unit test of the executor + integration test of a single-node flow run.
- Schema migrations: forward + backward test.

## CI gate
- All tests pass.
- TypeScript clean (no \`any\`, no \`unknown\` casts without justification).
- Lint clean.
- Coverage ≥80% on touched files.

## Mocking AI providers
Use \`apps/web/lib/test/mock-provider.ts\`. Tests never hit real OpenAI/Anthropic — flaky and expensive.`,
  },
  // ── Sales Playbook ──────────────────────────────────────────────────────
  {
    kbName: "Sales Playbook",
    title: "ICP — Ideal Customer Profile 2026.md",
    content: `# ICP — 2026

## Primary
- 200-2000 employees
- Engineering / Platform team building OR planning multi-agent systems
- Currently using: LangChain, CrewAI, AutoGen, or homegrown
- Pain: cost visibility, observability, multi-tenancy, OR memory persistence

## Secondary
- Sub-200 employees with multi-product business
- Solo founder with >$10K/mo LLM spend wanting visibility

## Disqualify
- "Just researching" with no project
- Hard requirement on Vertex AI or Bedrock only (we work via API, not native)
- Asked for pricing first without describing use case

## Champion profile
- Senior engineer or staff+ at the IC level, or VP Eng / CTO
- Has built or shipped an internal LLM tool before
- Reports up to someone who controls infra budget`,
  },
  {
    kbName: "Sales Playbook",
    title: "Battle Card vs LangGraph.md",
    content: `# Battle Card vs LangGraph

## When they bring it up
"Why not LangGraph?" usually comes from technical buyers who built a POC.

## Their strengths
- Python-first, deep integration with LangChain ecosystem.
- Excellent for research / prototyping single workflows.
- Recently added persistence (similar to our Brain).

## Their weaknesses
- Single-user / single-process model. Multi-tenancy is DIY.
- No built-in cost capping, audit logs, RBAC.
- No channels — they connect to APIs, not WhatsApp / Slack / web widgets.
- No UI for non-engineers to inspect runs, edit prompts, or manage agents.
- Memory is "thread-scoped"; no team or workspace recall.

## How we counter
"LangGraph is the SDK. Orchester is the platform. If your end users are devs, LangGraph is fine. If they're support, sales, ops, marketing — you'll spend 6 months building what we ship today."`,
  },
  // ── Legal & Contracts ───────────────────────────────────────────────────
  {
    kbName: "Legal & Contracts",
    title: "Data Processing Addendum (DPA) — EU.md",
    content: `# DPA — EU Customers (GDPR Art. 28)

## Scope
Applies to all EU/EEA/UK customers. Auto-incorporated into MSA via Schedule C.

## Roles
- Customer = Data Controller
- Orchester = Data Processor
- Subprocessors (AWS, Stripe, Plunk, etc.) = Sub-Processors. List maintained at orchester.io/legal/subprocessors.

## Cross-border transfers
EU → US: Standard Contractual Clauses (Module 2: Controller → Processor) attached as Appendix 1. Updated to Commission Implementing Decision 2021/914.

## Breach notification
We notify Customer within 48 hours of becoming aware of a personal data breach. Notification includes: nature, scope, affected categories, mitigation, contact for further info.

## Sub-processor changes
14-day prior notice. Customer can object within that window.

## Audit rights
Customer can audit annually, at their cost, with 30-day notice. SOC 2 Type II report (current) satisfies the right by default.

## Data subject requests
Customer routes via Settings → Privacy → Data export / Data deletion. Orchester responds within 30 days.`,
  },
  // ── Security Policies ──────────────────────────────────────────────────
  {
    kbName: "Security Policies",
    title: "Encryption at Rest & In Transit.md",
    content: `# Encryption Policy

## At rest
- Postgres: AES-256 native encryption (AWS RDS-managed keys via KMS).
- Customer secrets (provider API keys, channel tokens): AES-256-GCM at application layer using ENCRYPTION_SECRET. Key versioned via ENCRYPTION_KEYS for rotation.
- S3 backups: SSE-KMS with customer-managed KMS key.

## In transit
- All public traffic: TLS 1.3 enforced (RFC 8446). TLS 1.2 only allowed for legacy enterprise integrations on request.
- Internal service-to-service: mTLS within VPC.
- LLM provider calls: HTTPS with provider's cert chain validated.

## Key rotation cadence
- ENCRYPTION_SECRET: every 12 months or on compromise. Rotation process at docs/runbooks/rotate-encryption.md.
- TLS certs: 90-day Let's Encrypt, auto-renewed via cert-manager.
- Customer API keys: encouraged 90-day rotation; enforced for SOC 2 / SOX customers.

## Key escrow
No backdoors. ENCRYPTION_SECRET is held by 3 senior engineers via Shamir secret sharing (k=2).`,
  },
  // ── Design System ───────────────────────────────────────────────────────
  {
    kbName: "Design System",
    title: "Design Tokens — colors, spacing, type.md",
    content: `# Design Tokens v3

## Color
- Primary: \`violet-500\` (#8b5cf6). Variants: 400 (#a78bfa), 600 (#7c3aed).
- Backgrounds (dark): zinc-900 (#18181b), zinc-950 (#09090b). Cards: zinc-900/95.
- Foregrounds: text-zinc-100 (strong), text-zinc-400 (muted), text-zinc-500 (subtle).
- States: emerald-400 (success), amber-400 (warning), red-400 (error).

## Spacing
4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 (px). Use Tailwind's \`gap-*\` and \`p-*\` — no custom values.

## Typography
- Display: Syne, 600–700 weight, tight tracking.
- Sans: Geist Sans, 400–500 weight.
- Mono: Geist Mono, 400 weight.

## Border radius
4 (chip), 8 (button), 12 (card), 16 (modal), 9999 (pill).

## Shadows
\`shadow-[0_8px_24px_rgba(0,0,0,0.3)]\` for cards. No drop-shadows on text.

## Motion
Easing: \`cubic-bezier(0.22, 0.61, 0.36, 1)\` (Apple ease-out). Duration: 150ms (micro), 300ms (transitions), 500ms (entrances).`,
  },
  // ── Data Glossary ───────────────────────────────────────────────────────
  {
    kbName: "Data Glossary",
    title: "North Star Metrics — Activation, NRR.md",
    content: `# North Star Metrics

## Activated user
A signup that within 7 days has:
1. Connected at least one AI provider (OpenAI, Anthropic, etc.)
2. Created at least one agent with \`status='active'\`
3. Run that agent at least once (real message, not test)

Owner: Lautaro Domínguez (Data). Computed nightly into fct_activation. Materialized for the dashboard.

## NRR (Net Revenue Retention)
\`(start_MRR + expansion - churn - contraction) / start_MRR\`
- Cohort: workspaces that paid in the prior month.
- Window: trailing 12 months for the headline number, monthly for ops.
- Excludes free workspaces and trial conversions.

## Activation rate
\`activated_users / signups\`, by week cohort. Target: ≥35%. Below 25% triggers a product investigation.

## TTFR (Time To First Run)
Median time from signup to first successful agent run. Target: <30 minutes.

## Pitfall
"Activated" ≠ "engaged". Engaged = 5+ runs/week. Don't conflate. An activated user can churn the next week.`,
  },
];

interface KbRow {
  id: string;
  name: string;
  embeddingProvider: string;
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
}

async function main() {
  const { workspaceSlug } = parseArgs();
  const db = getDb();

  const wsRows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, workspaceSlug))
    .limit(1);
  const ws = wsRows[0];
  if (!ws) {
    console.error(`Workspace not found: slug=${workspaceSlug}`);
    process.exit(1);
  }
  console.log(`◆ Backfilling KBs for ${ws.name} (${ws.id})…`);

  // Decrypt the connected OpenAI key once, up front. Fail loudly if no
  // provider — no point doing chunking work we can't embed.
  const providerRows = await db
    .select()
    .from(schema.aiProviders)
    .where(
      and(eq(schema.aiProviders.workspaceId, ws.id), eq(schema.aiProviders.provider, "openai"))
    )
    .limit(1);
  const providerRow = providerRows[0];
  if (!providerRow || !providerRow.enabled) {
    console.error(
      "No enabled OpenAI provider for this workspace. Connect one in Settings → Providers."
    );
    process.exit(1);
  }
  const openaiKey = decrypt(providerRow.apiKey);
  console.log(`◆ OpenAI provider OK (key prefix: ${openaiKey.slice(0, 8)}…)`);

  const kbs = await db
    .select({
      id: schema.knowledgeBases.id,
      name: schema.knowledgeBases.name,
      embeddingProvider: schema.knowledgeBases.embeddingProvider,
      embeddingModel: schema.knowledgeBases.embeddingModel,
      chunkSize: schema.knowledgeBases.chunkSize,
      chunkOverlap: schema.knowledgeBases.chunkOverlap,
    })
    .from(schema.knowledgeBases)
    .where(eq(schema.knowledgeBases.workspaceId, ws.id));

  const kbByName = new Map<string, KbRow>();
  for (const k of kbs) kbByName.set(k.name, k as KbRow);

  let created = 0;
  let skipped = 0;
  let failed = 0;
  let totalChunks = 0;
  let totalTokens = 0;

  for (const seed of SEED_DOCS) {
    const kb = kbByName.get(seed.kbName);
    if (!kb) {
      console.warn(`Skip "${seed.title}" — KB "${seed.kbName}" not found.`);
      skipped++;
      continue;
    }

    // Skip if a ready doc with this title already has chunks.
    const existing = await db
      .select({
        id: schema.knowledgeDocs.id,
        status: schema.knowledgeDocs.status,
        chunkCount: schema.knowledgeDocs.chunkCount,
      })
      .from(schema.knowledgeDocs)
      .where(and(eq(schema.knowledgeDocs.kbId, kb.id), eq(schema.knowledgeDocs.title, seed.title)))
      .limit(1);
    if (existing[0]?.status === "ready" && (existing[0].chunkCount ?? 0) > 0) {
      console.log(`✓ ${kb.name} / ${seed.title} — already indexed, skipping`);
      skipped++;
      continue;
    }

    // Drop the stale row + its chunks if we're re-indexing.
    if (existing[0]) {
      await db
        .delete(schema.knowledgeChunks)
        .where(eq(schema.knowledgeChunks.docId, existing[0].id));
      await db.delete(schema.knowledgeDocs).where(eq(schema.knowledgeDocs.id, existing[0].id));
    }

    try {
      const chunks = chunkText(seed.content, kb.chunkSize, kb.chunkOverlap);
      if (chunks.length === 0) {
        console.warn(`Skip "${seed.title}" — chunkText returned 0 chunks.`);
        skipped++;
        continue;
      }
      // KB is configured for openai/text-embedding-3-small by default. If a
      // KB was custom-set to google/voyage, this script will misalign — it
      // only knows OpenAI. That's fine for the demo since we control the seed.
      const model = kb.embeddingModel ?? "text-embedding-3-small";
      const { vectors, tokensUsed } = await embedOpenAI(openaiKey, model, chunks);
      if (vectors.length !== chunks.length) {
        throw new Error(`Embed returned ${vectors.length} vectors for ${chunks.length} chunks`);
      }

      const docId = createId();
      await db.insert(schema.knowledgeDocs).values({
        id: docId,
        kbId: kb.id,
        workspaceId: ws.id,
        title: seed.title,
        source: "text",
        contentType: "text/markdown",
        byteSize: Buffer.byteLength(seed.content, "utf8"),
        status: "ready",
        chunkCount: chunks.length,
      });

      for (let i = 0; i < chunks.length; i++) {
        await db.insert(schema.knowledgeChunks).values({
          id: createId(),
          docId,
          kbId: kb.id,
          workspaceId: ws.id,
          ordinal: i,
          text: chunks[i]!,
          embedding: vectors[i]!,
          metadata: { backfill: true, model },
        });
      }

      totalChunks += chunks.length;
      totalTokens += tokensUsed;
      console.log(`✓ ${kb.name} / ${seed.title} — ${chunks.length} chunks, ${tokensUsed} tokens`);
      created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${kb.name} / ${seed.title} — ${msg}`);
      failed++;
    }
  }

  console.log("");
  console.log(
    `Done. created=${created}  skipped=${skipped}  failed=${failed}  chunks=${totalChunks}  tokens=${totalTokens}`
  );
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
