# Orchester full UI audit — 2026-06-06

Walk-through of every workspace screen against the live app (acme-inc demo
workspace) with focus on (a) UX/UI defects the user can see and (b)
Mnemosyne integration correctness.

## Screens covered

Home (Command Center) · Conversations · Org Chart · Teams · Agents (list +
Studio: Prompt+Model, Advanced/tools) · Flows (list + visual editor) ·
Employees · Knowledge bases · Memory (Brain Inspector + Graph) · Channels
· Integrations · Settings (General + AI Providers).

## What's working well

- **Home dashboard**: rich KPI strip + tokens/cost financial bar +
  30-day activity chart + cost-per-agent. Numbers reflect real seed
  data (38 active agents · 56 employees · 15.8K tokens · $0.10).
- **Conversations**: solid index with status/channel/agent/tag filters
  and Export CSV. Detail slide-over exposes a "Don't learn from this
  conversation" toggle — clean and well-placed Mnemosyne hook for
  per-thread opt-out.
- **Org Chart**: hierarchical layout with minimap, search, reset
  layout, zoom controls — looks professional even at 38 agents.
- **Teams**: 12 emoji-keyed team tiles, agent + channel counts each.
- **Agent Studio**: Prompt+Model / Advanced / Versions tabs render
  correctly. The earlier MISSING_MESSAGE crash from the JSON placeholder
  (P1) is gone. The Advanced tab's Tool registry exposes
  `brain_recall`, `memory_set/get/remove`, and `mnemosyne_remember` —
  Mnemosyne tools are reachable to agents.
- **Knowledge bases**: 10 KBs, every one tagged `Embedded with
openai/text-embedding-3-small`. Clear RAG-explainer copy.
- **Channels**: cleanly separates "Connect a new channel" (6 types)
  from "Connected channels" below — exactly the pattern the AI
  Providers fix mirrors.
- **Integrations**: Connected (Test API · OK) on top, Available grid
  below. Test/Edit/Delete actions present on the connected entry.
- **Settings → AI Providers**: P1 fix landed correctly — only OpenAI
  in `Connected (1)`. Anthropic / Google no longer show as connected
  when no key exists. "Paused" concept is gone.
- **Brain Inspector**: P2 data-restoration fix is live —
  `TOTAL FACTS 18 · PINNED 5 · ACTIVE 18 · FORGOTTEN 0`, plus
  30-day `ACTIVE FACTS` and `RECALL HIT RATE` charts. Real Mnemosyne
  data, not mock.
- **Memory Graph**: post-fd571b3, charge/link tuning + screen-px
  labels + zoomToFit padding 120 makes the 6-entity / 8-relation seed
  graph readable. The d3-force layout still piles tightly-connected
  nodes when link density is high; the rest of this audit doc lists
  that as a known follow-up.

## Issues found (by severity)

### Blocking

None. The product boots, no MISSING_MESSAGE / INVALID_MESSAGE crashes
on any tour. Brain Inspector shows real counts. AI Providers shows the
correct connected/available split.

### High — fix before next demo

1. **Embedded coverage shows 0%** on Brain Inspector. With 18 facts
   live, embedding indexing should be running. Either the background
   embedder hasn't been wired into the new Mnemosyne service, or the
   `embeddings.indexed` field in the health response is reporting `0`
   wrongly. Direct downstream of this: `RECALL HIT RATE` is flatlined
   at 0% — agents can't recall what they remembered.
2. **"Your AI is learning on its own — Waiting for the first cycle…"**
   banner on `/brain` is stuck. The auto-learn cycle in Mnemosyne
   isn't kicking off. Either there's no scheduler yet (per the M7
   notes — Mnemosyne cron deferred) or the orchester nudge that
   triggers an extraction job isn't firing. Decide whether to ship
   the banner _only_ when a cycle is actually scheduled.
3. **Agent → Model dropdown truncates** the model id in the closed
   state ("…de-sonnet-4-6"). The value is `claude-sonnet-4-6` — the
   left half is clipped because the trigger is too narrow. Either
   widen the dropdown or show the short label
   (`Claude Sonnet 4.6`) instead of the raw id.

### Medium — quality polish

4. **Employees list — no skeleton state**. The list takes a few
   seconds to populate on first nav and shows a blank white area with
   only the search box. Add a row skeleton for the load window.
5. **Employees list — rows aren't clickable**. There's no visible
   route into an employee detail page or panel. Even the avatar/name
   does nothing. Decide: either wire `/employees/[id]` or make this
   intentionally read-only and remove hover affordances.
6. **Agents list — group sections render empty by default**. The
   accordion collapses every team (Marketing, Comercial, …) leaving
   tall vertical gaps between headers. Either auto-expand the first
   N agents per group or remove the inter-group whitespace when
   collapsed.
7. **Flow editor — Spanish/English mix**. Top bar shows "Guardar" /
   "Ejecutar" while the step library uses English ("Manual start",
   "Search a step…"). Pick one language per locale and translate the
   stragglers.
8. **Home — KPI subtitle contrast is too low**. Labels "Active
   agents", "Conversations today", "Open now", "Escalation rate",
   "Resolution" sit at near-invisible zinc-on-zinc; lift the label
   color to at least `text-zinc-400` so the metric is legible without
   a hover.
9. **Memory Graph labels still overlap on dense clusters**. The
   commit fd571b3 makes 6 entities readable but with link density
   `≈ 2.7`, the charge force can't overcome link attraction. Two
   options: install `d3-force` directly so we can add a `forceCollide`
   keyed off label width, or fall back to manual label offset by node
   index when the simulation settles.
10. **"Tool" naming overlap on Agents Advanced tab**: three flavors of
    memory tool — `brain_recall`, `memory_set/get/remove`, and
    `mnemosyne_remember` — without a clear hierarchy in the
    descriptions. From the agent's POV: when does it pick
    `mnemosyne_remember` vs `memory_set`? Recommend renaming
    `memory_set/get/remove` to `scratchpad_*` (scoped, ephemeral)
    and keeping `mnemosyne_remember` + `brain_recall` for durable
    facts.

### Low — nits

11. **Knowledge cards opacity** — every KB card looks faintly
    disabled (low alpha). If that's intentional to convey
    "click-through to see contents", fine; otherwise raise to full
    opacity for the title row.
12. **Settings → AI Providers connected card looks washed out** —
    OpenAI tile reads as if disabled because of the same low-opacity
    treatment. Push opacity higher for the connected state to signal
    "this is the active key".
13. **Browse: Take a tour button** appears on many pages (Agents,
    Flows, Knowledge, Memory, Channels, Integrations). Either wire it
    to a real product tour or remove the dead button.

## Mnemosyne wiring verdict

- **Connection layer is correct.** Brain Inspector reads real values
  via the SDK-proxied `/api/mnemo/health/latest` route restored in
  task #106. The 18 facts come from the upstream service, not from
  Orchester's DB. Single source of credentials in Orchester's
  `ai_provider` table — Mnemosyne `.env` carries no provider tokens.
- **Recall pipeline isn't running.** Embedded 0% + Recall Hit Rate 0%
  - "Waiting for first cycle…" banner all indicate the background
    embed/extract job hasn't been wired into the standalone service
    (consistent with M7 being deferred). Until it runs, agents will
    remember (writes succeed → 18 facts visible) but won't recall
    (reads return nothing relevant). This is the next material piece
    of work.
- **Per-conversation opt-out works** — the toggle exists on the
  conversation detail panel and writes to the Mnemosyne service.
- **Graph data is real** — 6 entities / 8 relations come back from
  the workspace graph endpoint; the rendering issues are 100% client
  side.

## Recommended next sprint (ranked)

1. Wire the embedding worker so `Embedded` ratio becomes > 0% and
   `Recall Hit Rate` produces real curves (unblocks every chat
   feature).
2. Hide / repurpose the "Your AI is learning on its own — Waiting…"
   banner until there's a real cycle.
3. Fix the model dropdown truncation (1-line CSS change) and add the
   employee row skeleton + hover/click target (2 small UI tasks).
4. Decide language strategy and finish the flow-editor i18n keys.
5. Either install `d3-force` and add label collision OR accept the
   graph as-is for the demo and revisit when the graph scales past
   the 6-entity seed.
