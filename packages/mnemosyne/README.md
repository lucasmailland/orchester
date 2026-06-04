<div align="center">

# @orchester/mnemosyne

**Multi-tenant cognitive memory for AI agents — bitemporal, provider-agnostic, RLS-isolated.**

[![Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](../../LICENSE)
[![v1.6.0](https://img.shields.io/badge/version-1.6.0-violet.svg)](#)
[![Postgres + pgvector](https://img.shields.io/badge/runtime-Postgres%20%2B%20pgvector-336791.svg)](#)
[![TypeScript](https://img.shields.io/badge/types-strict-3178c6.svg)](#)

</div>

---

Mnemosyne is the memory layer of [Orchester](https://github.com/lucasmailland/orchester), extracted as a standalone package so you can drop it into any TypeScript product that needs **durable, recallable, auditable memory for AI agents**.

It is **not** a chat history store. It is a small but opinionated cognitive architecture: facts → episodes → entities → relations, with bitemporal time-travel, multi-source hybrid retrieval (BM25 + vector + graph), and a trust ladder that keeps the LLM from believing its own hallucinations.

> Used in production by Orchester to back every agent's recall layer. 928+ tests pass; isolation matrix proves cross-tenant correctness on every PR.

---

## Why memory?

LLMs forget after the context window closes. Slapping conversation history into every turn:

- **Burns tokens** — 50-turn history ≈ 6,000 tokens per turn at full price
- **Loses signal** — the model has to re-derive the user's preferences every time
- **Doesn't scale** — works for one chat, fails the moment you have 100 conversations across 10 agents

Mnemosyne extracts the **durable facts** from each conversation (preferences, decisions, configurations, patterns) and surfaces them on demand via a recall pipeline. The agent injects ~200 tokens of relevant facts instead of replaying the whole conversation. **~96% token reduction** on long-running agents.

---

## What's in the box

| Primitive            | Purpose                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `mnemo_fact`         | The atomic unit. `(subject, kind, statement, confidence, pinned, status)` with bitemporal validity and a pgvector embedding |
| `mnemo_decision`     | A choice the agent made + its rationale. Auditable.                                                                         |
| `mnemo_episode`      | A multi-fact narrative anchored to a moment in time                                                                         |
| `mnemo_entity`       | Canonical "things" (people, orgs, projects) with aliases + `canonical_id` for merge                                         |
| `mnemo_relation`     | Typed edges (`conflicts_with`, `derived_from`, `co_occurs`, …) for graph expansion                                          |
| `mnemo_review_queue` | Low-confidence inbox for human curation                                                                                     |
| `mnemo_summary`      | Pre-distilled per-agent profile blob for cheap injection                                                                    |

Plus pipelines: **extraction** (LLM-driven), **embedding** (tiered), **dedup**, **prune**, **consolidation** (REM-style), **decay**, **auto-pin**, **review sweep**.

---

## Install

> Mnemosyne currently ships as a workspace package inside the Orchester monorepo. It **will** be published to npm in v2.0 once the public API stabilises — pin against the GitHub tag `mnemosyne-v1.6` until then.

```bash
# inside an existing pnpm monorepo
pnpm add @orchester/mnemosyne@workspace:*

# peer deps (you probably already have these)
pnpm add drizzle-orm postgres @paralleldrive/cuid2 zod lru-cache
```

You also need a Postgres database with:

- **pgvector ≥ 0.7** (for `halfvec(1536)` quantization)
- Mnemosyne migrations `0017` through `0052` applied — see `packages/db/migrations/`

---

## 60-second tour

```ts
import {
  withMnemoTx,
  searchMnemo,
  saveFactWithCandidates,
} from "@orchester/mnemosyne";

// 1. Teach the system a fact.
await withMnemoTx("ws_acme", async (tx) => {
  await saveFactWithCandidates({
    workspaceId: "ws_acme",
    statement: "The customer Acme prefers communication in Spanish.",
    subject: "acme",
    kind: "preference",
    scope: "global",
    confidence: 0.9,
    enqueueOnNoJudge: true,
    tx,
  });
});

// 2. Recall it later from a different conversation.
const hits = await withMnemoTx("ws_acme", (tx) =>
  searchMnemo({
    workspaceId: "ws_acme",
    query: "what language should I write to acme in?",
    topK: 5,
    tx,
  })
);

console.log(hits[0]?.fact.statement);
// → "The customer Acme prefers communication in Spanish."
```

What just happened:

1. **Embedded** the statement at write time (default tier)
2. **Indexed** it for BM25 (Postgres FTS on `text_lemmatized`)
3. **Hybrid-searched** at read time (BM25 + cosine, blended)
4. **Reranked** the top-K
5. **Enforced workspace isolation** via RLS+FORCE Pattern A — `ws_other_tenant` couldn't read this row even if it crafted the right `subject`

---

## The non-obvious design decisions

### 1. Bitemporal by default

Every fact has `valid_from` / `valid_to` (when the world thought this was true) **and** `created_at` / `updated_at` (when our system knew). You can ask: _"what did my AI believe on June 1st?"_ — and Mnemosyne replays the state.

```ts
await searchMnemo({ workspaceId, query, asOf: new Date("2026-06-01"), tx });
```

### 2. Trust ladder, not booleans

Facts carry a `provenance`: `verified` (human approved) > `llm` (extractor-derived) > `heuristic` > `pending` > `unverified`. Recall surfaces this in the `reasons` field so the consuming agent can decide how to weight a fact. **No silent hallucination.**

### 3. RLS+FORCE Pattern A

Tenant isolation is enforced at the database, not the application:

- Every Mnemosyne table has `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
- Every query happens inside `withMnemoTx(workspaceId, fn)` which:
  - Sets `app.workspace_id = $1` via `SET LOCAL`
  - Downgrades the role to `app_user` (no BYPASSRLS)
- Policies USE `current_setting('app.workspace_id', true)::text`

Result: even a SQL injection bug in app code can't leak cross-tenant data. The `tests/isolation/` matrix in Orchester proves this on every PR.

### 4. Provider-agnostic + degradation modes

Mnemosyne defines `LlmCallFn` and `EmbedFn` as injection points — the host supplies the actual provider. Three operational modes:

- **Mode A** (no LLM, no embed): pure BM25 + heuristic extraction. Works.
- **Mode B** (embed only): adds semantic recall on top of BM25.
- **Mode C** (LLM + embed): full extraction, consolidation, contradiction judge.

`resolveActiveMode()` reads provider health and degrades gracefully if a provider goes down mid-day.

### 5. Async maintenance, not synchronous bookkeeping

Writes are cheap. The expensive work — dedup, prune, consolidation, summary distillation, health snapshots — runs on cron, NOT on the hot path. The agent runtime only ever **reads** memory; everything that mutates structure happens in the background.

A fresh workspace pays only the embed + insert on every fact, and the LLM-heavy work (consolidation, contradiction judgment) happens once a week off-peak.

---

## The public API (stable surface)

| Symbol                                                   | Purpose                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `withMnemoTx(workspaceId, fn)`                           | The ONE entry point for tenant-scoped DB work. Sets GUC + downgrades role. **Always use this.** |
| `searchMnemo({ workspaceId, query, … })`                 | Hybrid BM25 + vector + graph recall over facts. Returns `RecallHit[]`.                          |
| `recallUnified({ workspaceId, query, … })`               | Multi-source recall: facts + KB chunks in one blended ranking.                                  |
| `saveFactWithCandidates({ … })`                          | Insert a fact AND surface potential contradictions for review.                                  |
| `createFact({ … })`                                      | Lower-level: just insert (no contradiction surfacing). Used by extraction.                      |
| `getOrComputeSummary({ workspaceId, agentId, userId? })` | Read the pre-distilled summary blob; falls back to a heuristic on cold start.                   |
| `renderFactsCompact(facts)`                              | Dense token-efficient render for `<recalled-memory>` blocks.                                    |
| `MEMORY_PROTOCOL_V1`                                     | Frozen system-prompt artifact agents inject so they know HOW to use memory tools.               |
| `MEMORY_RECALL_GUIDANCE`                                 | Operator-facing copy explaining recall trust ladder.                                            |
| `enqueueReview({ … })`                                   | Add a row to the review queue for human curation.                                               |
| `resolveActiveMode({ … })`                               | Decide A/B/C mode given capability + health.                                                    |
| `detectPII / redactPII`                                  | Inline PII scrubber for facts about external users.                                             |
| `MNEMOSYNE_VERSION`                                      | Current version constant.                                                                       |

The full `index.ts` exports the lower-level primitives (telemetry callbacks, embedding-tier resolver, multi-term boost, etc.) for callers who want to compose their own retrieval pipeline.

---

## Using Mnemosyne in another product (3 paths)

### Path 1 — Import the package directly (TS / Node)

```ts
import {
  withMnemoTx,
  searchMnemo,
  saveFactWithCandidates,
} from "@orchester/mnemosyne";
// ... see "60-second tour" above
```

Your product gets a typed API, RLS isolation, and the full recall pipeline. Cost: you also adopt the migration set and the Postgres + pgvector dependency.

### Path 2 — Use it via MCP (any language, any client)

Orchester exposes Mnemosyne over the Model Context Protocol. Any MCP-aware client (Claude Desktop, Cursor, Gemini, custom agents) gets these tools out of the box:

- `memory_recall` — recall facts by free-text query
- `memory_remember` — persist a new fact
- `memory_pin` — protect a fact from prune/forget
- `memory_forget` — archive a fact (recoverable)
- `memory_timeline` — list recent memory events

Auth is per-workspace API key with `read` / `write` scopes. See `apps/web/lib/mcp/server.ts` for the tool catalog.

```jsonc
// claude_desktop_config.json
{
  "mcpServers": {
    "orchester-memory": {
      "command": "node",
      "args": ["./orchester-mcp/stdio-bridge.mjs"],
      "env": { "ORCHESTER_API_KEY": "..." },
    },
  },
}
```

### Path 3 — Direct HTTP (Orchester-hosted)

`/api/mnemo/*` exposes facts, decisions, entities, health, review queue, and the time-travel state. RBAC mirrors the workspace role (`admin+` for ops, `editor+` for curation). See `apps/web/app/api/mnemo/` for the route catalog.

---

## What we DON'T do (yet)

- **Real-time recall during streaming.** Recall happens at turn boundaries. Sub-token latency is not a goal.
- **Cross-workspace recall.** Org-level consolidation exists (`mnemoOrgFactView`) but agent-runtime hits stay workspace-scoped. By design.
- **Embedding model swapping mid-flight.** The embedding model is a workspace-level setting; changing it requires a backfill.
- **Generic vector DB adapter.** We use Postgres + pgvector intentionally — it's the only adapter that ALSO gives us RLS, multi-statement transactions, and bitemporal SQL in one place.

---

## License

Apache 2.0 — see [LICENSE](../../LICENSE).

---

<div align="center">

**Designed and built as part of [Orchester](https://github.com/lucasmailland/orchester).**
**Standalone-ready. Used in production. Bring your own LLM.**

</div>
