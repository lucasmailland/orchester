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

### 1. Recall/extraction pipeline — Embedded coverage still 0%

The dataset in `mnemo_fact` shows 18 live facts with zero embeddings.
The auto-extraction loop and the embedder are wired in the host
side but the Mnemosyne server still needs a per-workspace LLM
credential to run extraction and re-embedding. Architecture options
captured here so the next sprint can pick one:

- **Option A — Rebuild M1–M6 (workspace_config in Mnemosyne).**
  Original plan: migration `0054_mnemo_workspace_config.sql` + AES
  encryption module + 3-endpoint CRUD + SDK methods + resolver
  chain. Orchester pushes the OpenAI key into Mnemosyne via
  `setWorkspaceConfig`. Was reverted earlier because the test data
  was mocked; the architecture itself is sound. Best long-term
  answer, ~2 hours of focused work.
- **Option B — Push pre-computed vectors from Orchester at write
  time.** Orchester computes embeddings using its OpenAI key and
  sends the vector alongside the fact on every write. Mnemosyne
  stores what it's given; never needs a key. Lighter touch but
  requires changing every `remember(...)` call site on the host
  to compute + attach a vector.
- **Option C — Per-request key forwarding header.** Orchester
  attaches `X-Mnemo-Provider-Key` to every Mnemosyne call;
  Mnemosyne uses it for the request and never persists it. Closest
  to "stateless creds" — Mnemosyne would still need to know how to
  embed, which means accepting a configurable backend per request.

Recommendation: **Option A**, properly tested this time. The
duplicated work isn't huge and Mnemosyne becomes a real
multi-tenant service instead of a single-key process.

### 2. Embedding-job scheduler

Even with credentials, Mnemosyne needs to run the cron that picks
up unembedded facts (and the extraction job that turns recent
conversations into fact candidates). M7 was deferred; the host
side already nudges Mnemosyne when ready. Same sprint as #1.

### 3. Memory Graph — dense clusters still overlap labels

The collision force helps but on a graph where every pair has a
`related` edge, the link force still pulls neighbours into each
other. Two follow-ups:

- Tune `forceCollide.strength` to ~1.0 (currently 0.9) and weaken
  link force further (`link.strength(0.1)`).
- For graphs with > 30 nodes, swap to a hierarchical layout per
  entity_kind cluster instead of free force-directed.

### 4. Memory tool naming clarity

`brain_recall` + `memory_set/get/remove` + `mnemosyne_remember` —
three flavors of memory tool with overlapping descriptions. From
the agent's POV it's not obvious which to call. Rename
`memory_set/get/remove` to `scratchpad_*` (the actual semantic:
scoped, ephemeral key-value) and keep `mnemosyne_remember` +
`brain_recall` for durable facts.

### 5. Employees — UX choice

The list isn't clickable, has no detail page, and shows no
skeleton during the SSR window. Decide: either wire
`/employees/[id]` or remove the row-hover affordance to signal
"this is read-only metadata". Leaving as-is is the worst of both
worlds.

### 6. Take a tour buttons

The TourProvider infrastructure exists (TourSpot, HelpDrawer,
PageHero). Verify each "Take a tour" button on the live tour
list before next demo so none are stubs.
