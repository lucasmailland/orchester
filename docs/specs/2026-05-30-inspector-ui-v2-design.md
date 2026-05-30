# Inspector UI v2 — Recall Pipeline Visualizer Design

**Status:** Design — implementation-ready when the user approves the shape.
**Author:** Initial draft 2026-05-30.
**Prerequisite:** v1.1 `onMetric` telemetry callback (shipped this session).
**Predecessor:** `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/BrainInspectorClient.tsx` — current Inspector.

---

## 1. Goal

Make the recall pipeline **legible**. Today a user can see the result (the final 3-5 facts the agent retrieved) and they can see the inputs (the workspace fact list). What happens in between — pointer lookup, drawer-grep, full first-stage, rerank, prune, diversity cap, graph expansion — is a black box.

Inspector UI v2 surfaces every stage as a visual funnel so users can answer:

- "Why didn't fact X surface for this query?"
- "Which stage dropped fact Y?"
- "Did the reranker fire? Did the early-exit skip it?"
- "How many entities competed for the diversity cap?"
- "What did the graph-expansion add?"

---

## 2. Surface

### 2.1 Entry point

New route: `/[locale]/[workspaceSlug]/brain/recall-debug`

Linked from the existing `BrainInspectorClient` top toolbar — a new "Debug Recall" button next to the Time Travel picker.

### 2.2 Layout (one-page, no nested tabs)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Recall Debug — workspace: lucasm-personal                          │
├──────────────────────────────────────────────────────────────────────┤
│  Query input (textarea, multi-line)                  [ Run recall ]│
│  ┌────────────────────────────────────────┐  ┌────────────────────┐ │
│  │ Options                                │  │ Source agent       │ │
│  │ ☑ HyDE  ☑ Rerank  ☑ Graph expand        │  │ ▾ default          │ │
│  │ ☑ Pointer routing  ☐ Time travel       │  │                    │ │
│  │ maxResults: [3]                        │  └────────────────────┘ │
│  └────────────────────────────────────────┘                         │
├──────────────────────────────────────────────────────────────────────┤
│  PIPELINE FUNNEL  (rendered after a recall call)                   │
│                                                                      │
│  query                                              ⏱ 0 ms          │
│   │                                                                  │
│   ▼ query_prep                                      ⏱ 312 ms        │
│   ├ contextualized: "what does the user prefer in databases?"      │
│   └ HyDE doc: "The user prefers PostgreSQL because..."             │
│   │                                                                  │
│   ▼ pointer_lookup                                  ⏱ 4 ms · 2 hits│
│   ├ entity: User Lucas (score 0.87)                                 │
│   └ entity: Project Pixel (score 0.42)                              │
│   │                                                                  │
│   ╋ parallel ─────────────────────────────────────────────────────  │
│   │  ▼ first_stage (fts+vector)        ⏱ 38 ms · 15 hits           │
│   │  └ top: "user prefers PostgreSQL"     score 0.92                │
│   │  ▼ drawer_grep                      ⏱ 11 ms ·  6 hits           │
│   │  └ top: "User Lucas works in TypeScript" score 0.81             │
│   ╋ merge ────────────────────────────────────────────────────────  │
│   │                                                                  │
│   ▼ co_location_boost                               +0.04 × 3       │
│   ├ Entity "User Lucas": 3 facts → boosted                          │
│   │                                                                  │
│   ▼ single_term_dampener                            (skipped)       │
│   │                                                                  │
│   ▼ rerank                                          ⏱ 87 ms         │
│   ├ model: cohere/rerank-3.5                                        │
│   ├ early_exit: false                                               │
│   │                                                                  │
│   ▼ prune                                           dropped 1       │
│   ├ removed near-duplicate of "user prefers TypeScript"             │
│   │                                                                  │
│   ▼ diversity                                       dropped 2       │
│   ├ cap=2 per entity; User Lucas had 5 hits → kept top 2            │
│   │                                                                  │
│   ▼ graph_expand                                    ⏱ 22 ms · +2    │
│   ├ from "User Lucas" via part_of (decay 0.7 × 1.0)                 │
│   └ from "Project Pixel" via related (decay 0.7 × 0.6)              │
│   │                                                                  │
│   ▼ FINAL (5 hits)                                  ⏱ total 474 ms │
│   1. "user prefers PostgreSQL"         score 0.96  reasons: …       │
│   2. "User Lucas works in TypeScript"  score 0.85  reasons: …       │
│   3. ...                                                            │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.3 Per-stage card

Each stage in the funnel is a collapsible `<StageCard>` with:

- **Header line:** stage name · duration · count · top score · status badge (passed/dropped/skipped).
- **Body (expandable):** stage-specific detail — first 3 hits with scores, dropped items with reason, parameters used.
- **Color coding:** green (passed all items), yellow (dropped some), gray (skipped — e.g. graph-expand when off, dampener when query has multiple terms), red (errored).

---

## 3. Data flow

### 3.1 New API endpoint

```
POST /api/mnemo/recall-debug
Body: { query, options: {...} }
Response: {
  hits: RecallHit[],
  trace: {
    events: RecallMetricEvent[],
    queryPrep: { contextualized: string, hydeDoc: string | null },
    pointerHits: PointerHit[],
    firstStage: { mode, topHits },
    drawerGrep: { drawers, topHits },
    rerank: { model, earlyExit, indicesIn, indicesOut },
    prune: { removed: Array<{ factId, reason }> },
    diversity: { cap, droppedPerEntity },
    graphExpand: { neighbors, decayUsed },
  }
}
```

The endpoint wraps `recallUnified` with two things:

1. A capturing `onMetric` callback that pushes every event into the response `trace.events` array (instead of going to Sentry).
2. A "trace mode" flag on `recallUnified` (NEW — needs to be plumbed through to `searchMnemo`) that captures the intermediate state of each stage (top hits, dropped items, parameters). This is opt-in and ONLY used for debugging — the production hot path stays cheap.

### 3.2 RPC vs. SWR

Single fire-and-forget POST per "Run recall" click. No polling, no SSE. Recall calls are < 1s end-to-end — fine to render the funnel after the await.

### 3.3 Access control

Endpoint requires `workspace.member` role minimum. The trace can include user-data substrings (fact statements). RLS already gates fact reads — the endpoint inherits.

Auditable: emit an `inspector.recall_debug` audit event per call (rate-limited 10/min/user) so an admin can spot misuse.

---

## 4. Implementation breakdown

### 4.1 Package changes (mnemosyne)

**New flag on `SearchMnemoInput`:**

```typescript
/**
 * v1.1+ — when true, the pipeline captures per-stage diagnostic data
 * (top hits, dropped items, intermediate parameters) and returns it
 * alongside the result via `RecallHit.trace`. Only intended for
 * debugging UIs; adds ~2-5ms of overhead and ~500B of JSON per call.
 */
captureTrace?: boolean;
```

When true, the pipeline:

- Collects `prunePostRecall` removed items.
- Collects `diversifyByEntity` dropped items.
- Collects `fetchOneHopNeighbors` raw neighbor list before merge/dedup.
- Returns them in a new `SearchTrace` shape distinct from `RecallHit[]`.

API: `searchMnemoWithTrace(input): Promise<{ hits, trace }>` — new entry point that wraps `searchMnemo` to keep the existing return type stable. Same for `recallUnifiedWithTrace`.

**Why not on the existing `searchMnemo`:** Returning a discriminated union (`RecallHit[] | { hits, trace }`) would break every caller. The double-entrypoint pattern keeps the production path byte-identical.

### 4.2 Host changes (apps/web)

- **New route handler:** `apps/web/app/api/mnemo/recall-debug/route.ts`
- **New client:** `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/recall-debug/page.tsx` + `RecallDebugClient.tsx`
- **New components:**
  - `apps/web/components/brain/RecallFunnel.tsx` — top-level funnel layout
  - `apps/web/components/brain/StageCard.tsx` — per-stage collapsible card
  - `apps/web/components/brain/StageDetail.tsx` — stage-specific detail body
- **New hook:** `apps/web/lib/hooks/use-recall-debug.ts` — single SWR-style mutation for the debug endpoint.

### 4.3 Testing

- Unit: `tests/unit/recall-trace.test.ts` — verify captured trace matches the shipped trace shape, sample dropped items show up, skipped stages are flagged.
- Integration: `apps/web/tests/integration/recall-debug-route.spec.ts` — fire a debug call, assert the response trace matches the pipeline events.
- Visual: Playwright snapshot of the funnel page after a recall on the seed workspace.

---

## 5. UX details that matter

- **Compare mode (v2.1, after MVP):** run the same query with two different option sets side-by-side, diff the funnels. Use case: "did disabling HyDE actually change anything for this query?"
- **Permalink:** the run is cached for 1h in `mnemo_recall_debug_cache` (new table, workspace-scoped, TTL via partial index). The page URL gets a `?run=<id>` parameter so a debug trace is shareable.
- **Stage hover → metric link:** hovering a stage card surfaces a "view metric in dashboard" link that deep-links to the Sentry / OTel panel for `mnemo.recall.<stage>.duration_ms` filtered to the current workspace.
- **Empty states:** if a stage emits no events (because it was skipped), the card shows the skip _reason_ — "Reranker early-exit fired at score 0.94 ≥ 0.92 threshold" not just a gray "skipped" label.

---

## 6. Out of scope (v2.0)

- **Live tail of agent-runtime recall calls.** Tempting but requires SSE + per-workspace rate limit thinking. Defer.
- **Comparing runs across time.** "How did this query's recall change after I ran the dedup janitor?" Useful but needs persistent run storage policy.
- **Editing the pipeline live.** No "click to disable rerank for this re-run" interactivity in v1; the Options panel covers that statically.

---

## 7. Sequence

1. Land the `captureTrace` plumbing in mnemosyne (package change, additive).
2. Land the new `/api/mnemo/recall-debug` route handler.
3. Land the page route + funnel components.
4. Wire up Storybook snapshots for the empty / loading / loaded / errored states.
5. Add the entry-point link in `BrainInspectorClient`.

Implementable in 2-3 focused sessions if approved.

---

## 8. Open questions

- **PII redaction in trace.** Fact statements may include PII. The Inspector already shows statements unredacted (that's intentional — Inspector is for the workspace owner). Confirm: same policy for the debug trace?
- **`captureTrace` budget impact.** Estimated 2-5ms + 500B per call. Acceptable for debug endpoint, do NOT enable it for the agent-runtime hot path. Add a regression test asserting the production path doesn't pass `captureTrace`.
- **Funnel rendering library.** Inline divs with Tailwind keep the bundle small. A Sankey-style lib (D3-sankey) would look better but adds ~30KB gzipped. Default: inline divs; revisit if users ask for visual fidelity.
