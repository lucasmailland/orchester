# Orchester full UI audit — 2026-06-06

Walk-through of every workspace screen against the live app (acme-inc demo
workspace) with focus on (a) UX/UI defects the user can see and (b)
Mnemosyne integration correctness.

> **Status:** the polish pass on this audit landed in commits `fd571b3`
> (graph), `99…` (ghost providers), `...` (agent model remap), and the
> "batch UI polish" commit. The remaining items are tracked in the
> **Outstanding** section at the bottom.

## Screens covered

Home (Command Center) · Conversations · Org Chart · Teams · Agents (list +
Studio: Prompt+Model, Advanced/tools) · Flows (list + visual editor) ·
Employees · Knowledge bases · Memory (Brain Inspector + Graph) · Channels
· Integrations · Settings (General + AI Providers).

## ✅ Fixed in this audit pass

- **AI Providers — ghost rows removed.** The demo seed was inserting
  Anthropic + Google "draft" rows with `apiKey: "demo:placeholder:not-real"`
  and `enabled: false`. They were hidden from `Connected` by the P1 fix
  but still rotted in the DB. Dropped from the seed; deleted from the
  local dev DB.
- **Agents and message history remapped to OpenAI.** 68+8 agents +
  73+4 historic versions + every recorded assistant message that
  carried a `model` field were on Claude variants. With only OpenAI
  connected, every agent now reads `gpt-4o` (or `gpt-4o-mini` for the
  fast-tier ones) and the seed was updated so a re-seed lands the
  same way.
- **Memory Heartbeat banner — "Waiting for the first cycle…" was a
  bug, not a missing scheduler.** The health route emitted
  `snapshotAt` while the hook + banner read `capturedAt`. Renamed
  (keeping `snapshotAt` as a backwards-compat alias). Banner now
  reads `Updated yesterday` correctly.
- **Brain Inspector data display** already worked (TOTAL 18, PINNED 5,
  ACTIVE 18) — confirmed live.
- **Home — KPI subtitle contrast.** `text-muted` was sub-50% readable
  on the dark KPI card. Bumped to `text-body` (primary variant) and
  `text-white/75` (colored variants). The metric names — Active
  agents, Conversations today, Open now, Employees, Escalation rate,
  Resolution — are now legible at the design size.
- **Agent Studio — MODEL dropdown truncation.** The closed trigger
  clipped the leading characters of long ids ("…de-sonnet-4-6").
  Added `min-w-[200px]` + inner `truncate` so labels render fully or
  clip cleanly on the right.
- **Agent list — pretty model labels.** The card chips showed raw
  `gpt-4o` etc. Extended `MODEL_SHORT` / `MODEL_COLOR` to OpenAI
  (GPT-4o, GPT-4o mini, GPT-4.1, o3, o3-mini, o4-mini) with an
  emerald/teal palette so the provider family is visually obvious.
- **Settings → AI Providers — connected card lift.** The OpenAI tile
  read as washed-out. Now carries a clear emerald wash + ring +
  emerald-tinted icon corner so "this is the live key" is
  unmistakable.
- **Flow editor — Spanish/English mix.** The "Guardar" / "Ejecutar"
  buttons were hardcoded in a surface that's otherwise i18n'd.
  Switched to `t("save")` / `t("runFlow")` from the existing
  `pages.flows.builder` namespace; the loading state uses
  `t("running")`.
- **Memory Graph — label collision force.** `d3-force` is now a direct
  dep and the graph injects a `forceCollide` whose radius is
  proportional to the label width (clamped 28–80 px). Dense graphs
  still cluster, but neighbours can no longer share the same screen
  pixel.
- **Memory Graph readability** (from `fd571b3`) — charge -1200, link
  distance 220 with weakened strength, screen-pixel label sizing
  with a backdrop pill, zoomToFit padding 120.

## Verified working

- **Mnemosyne connection layer** — Brain Inspector reads real values
  via the SDK-proxied `/api/mnemo/health/latest` route. The 18 facts
  come from the upstream service.
- **Per-conversation memory opt-out** — the "Don't learn from this
  conversation" toggle on the Conversations detail panel writes to
  Mnemosyne.
- **Graph data is real** — 6 entities / 8 relations come back from
  the workspace graph endpoint.
- **Single source of credentials** — Orchester's `ai_provider`
  table only. Mnemosyne `.env` carries no provider tokens (the env
  has a `MNEMO_LLM_API_KEY=sk-replace-me` placeholder that's never
  read in production paths now that workspace embeddings are wired
  through the host-provided `embedFn`).
- **Agent Studio renders cleanly** — no MISSING_MESSAGE /
  INVALID_MESSAGE crashes. The dropdown only lists OpenAI models
  (one entry per id, no duplicates).

## Outstanding — material work remaining

### 1. ✅ Recall pipeline — Embedded coverage went 0% → 100%

Backfill landed via `apps/web/scripts/backfill-mnemo-embeddings.ts`.
The script reads Orchester's OpenAI key (AES-256-GCM decrypt inlined
to keep tsx clean of `server-only`), pulls every fact where
`embedding IS NULL` from Mnemosyne Postgres, batches calls to
`/v1/embeddings`, and writes the halfvec(1536) +
`embedding_model` + `embedding_version` back into `mnemo_fact`.
Bitemporal interval, statement, attribution untouched. Re-runs are
idempotent.

Local dev DB: 18/18 facts embedded for `acme-inc`. Brain Inspector
shows **Embedded 100%**, the Heartbeat banner says "Updated just
now", and `RECALL HIT RATE` will start moving as soon as new
conversations exercise the recall path.

The cron / scheduled "auto-extract from recent conversations" job
remains the next sprint (see #2 below); the host-side `embedFn` is
already wired so any new fact written through Orchester's worker is
embedded inline.

### 2. Embedding-job scheduler (deferred)

For continuous extraction (new facts from new conversations) the
Mnemosyne service needs a cron. M7 was deferred and intentionally so
— Orchester's worker already covers the synchronous "embed-on-
write" path. The cron is only required when the auto-extraction loop
is turned on, which is a separate product decision.

### 3. ✅ Memory Graph — collision force tuned

`forceCollide.strength = 1.0` + `link.strength = 0.1` so spread
wins on dense seeds. On the 6-entity / 8-relations test graph the
nodes still sit close because every pair shares a `related` edge,
but the labels no longer overlap pixel-for-pixel. For graphs > 30
nodes a hierarchical layout per `entity_kind` is the next step.

### 4. ✅ Memory tool naming clarity

Tool ids unchanged (renaming would break every existing agent
config) but the descriptions in `lib/tools.ts` now each begin with
a one-word category — `SCRATCHPAD`, `BRAIN` — and explicitly point
to the right alternative for the inverse use case
(`memory_set` says "for free-form durable facts, use
`mnemosyne_remember`"; `brain_recall` says "for scratchpad
retrieval, use `memory_get`"). Agents picking the wrong tool now
get a corrective hint inside the descriptions themselves.

### 5. ✅ Employees — row affordance dropped

The pseudo-hover background on each row promised a drill-in that
doesn't exist. Removed; the budget pill is now the only
interactive surface on the page. When `/employees/[id]` is built
the affordance can come back together with the route.

### 6. Take a tour buttons

The TourProvider infrastructure exists (TourSpot, HelpDrawer,
PageHero). Verify each "Take a tour" button on the live tour
list before next demo so none are stubs.
