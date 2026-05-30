# Mnemosyne v2 — Design Spec (Draft)

**Status:** Draft — not implementation-ready. Captures decisions earned during v1.0 → v1.6 → v1.1 and the breaking changes v2 will introduce.
**Author:** Initial draft 2026-05-30. Open for review.
**Predecessor:** [Mnemosyne v1.x design](./2026-05-24-mnemosyne-design.md) (~166KB, monolithic).

---

## 0. TL;DR — what changes from v1.x

| Aspect              | v1.x                                       | v2                                                                                                   |
| ------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Rerank              | Opt-in (`rerank?: RerankFn`)               | **Always on**. `noopRerank` is the explicit opt-out.                                                 |
| Retrieval primitive | Pool-first (FTS-or-vector → rank)          | **Drawer-first** (entity drawers → grep → fill).                                                     |
| Episodes            | Side primitive, opt-in linking             | **First-class**. Every fact belongs to ≥1 episode (synthetic for orphans).                           |
| Recall budget       | Adaptive cap (tiered)                      | Adaptive cap **per-stage** (drawer / fill / expand each have their own).                             |
| Graph traversal     | 1-hop, fixed decay                         | 1-hop default, **2-hop opt-in** with priority-aware Dijkstra-style scoring.                          |
| Provenance          | Heuristic-or-LLM (binary)                  | **Trust ladder**: `verified` > `llm` > `heuristic` > `pending` > `unverified`.                       |
| MCP surface         | `mnemo_recall` + `mnemo_get_fact` + others | **Unified**: `mnemo` tool with verb-based sub-actions. Same context budget, half the discovery cost. |

Total breaking surface: ~5 public API changes, all type-narrow widenings (additions). Old callers should compile; behavior shifts are documented per-section below.

---

## 1. Motivation

v1.x shipped 47 features across 6 minor releases. The codebase is healthy (10/10 final audit, 447/447 tests) but the **architecture has rotated under it**:

1. **Drawers won.** v1.1 #1+#2 (pointer index + drawer-grep) is the single highest-impact retrieval signal in our test set (96.6% R@5 in mempalace; comparable lift in our own LongMemEval fixtures). The pool-first abstraction is now the legacy path even though it's the default code path.
2. **Episodes are everywhere.** Every host caller that uses `mnemo_fact` for anything richer than raw preferences eventually wants temporal grouping. The v1.4 episode primitive is opt-in, which means it's underused, which means agents can't reason about "what happened in our last conversation about X" without the host re-fetching the conversation log.
3. **Rerank is free now.** v1.6's local lexical reranker is pure-TS, deterministic, and faster than the FTS scoring it competes with. The opt-in framing is a vestigial worry from v1.0 when only Cohere was available.
4. **Telemetry exists.** v1.1 added per-stage telemetry (`onMetric`). v2 is the first version where we can calibrate magic numbers (e.g. #5 multi-term multiplicative, #9 signal-strength cutoff) against real distributions instead of guessing.

The audit-driven v1.1 batch (23/29 ideas implemented) has saturated the v1.x architecture's improvement budget. The remaining gains live in v2-shape changes.

---

## 2. Pipeline reshape: drawer-first

### 2.1 Current (v1.1) pipeline

```
query
  → query-prep (HyDE + contextualize)
  → pointer-lookup → drawer_entity_ids (optional, default on)
  → parallel(first_stage, drawer_grep)
  → mergeHitPools
  → co-location boost (#6)
  → single-term dampener (#4)
  → rerank (default noop, Cohere when keyed)
  → prune cosine ≥ 0.88
  → entity-diversity cap (#8)
  → graph_expand 1-hop (opt-in)
  → final cap
```

The drawer-grep tier was bolted on as a _secondary_ signal that merges into the primary first-stage pool. In practice, when drawers exist, they should be the **primary** signal — the full first-stage adds noise. When drawers don't exist (cold workspace, generic query) the full first-stage is the fallback, not the default.

### 2.2 v2 pipeline

```
query
  → query-prep
  → pointer-lookup → drawer_entity_ids
        if hits → drawer-first path
        if misses → cold-recall path
  ↓
[drawer-first path]              [cold-recall path]
  → drawer-grep (top K*5)          → full first-stage (top K*5)
  → fill: if < K*2, top-up from    → (no fill, drawers don't exist)
    first-stage on the SAME query  ↓
  ↓                                ↓
  ──► common tail ◄──
  → rerank (always on)
  → prune
  → diversity cap
  → graph_expand (default 1-hop, 2-hop opt-in)
  → episode-coherence boost (new — see §4)
  → final cap
```

### 2.3 Why drawer-first works

- **Precision floor:** entity-filtered FTS has 5-10× higher precision than full-FTS for entity queries (telemetry-confirmed in v1.1 — see `mnemo.recall.drawer_grep.top_score` vs `mnemo.recall.first_stage.top_score` distributions).
- **Recall preserved via fill:** when drawer-grep returns fewer than `K*2` candidates, the fill step pulls from the full first-stage. The merge is keyed on `fact_id` so duplicates collapse; the fill items inherit a 0.85× decay (signal: "this came from a generic search, not your entity drawer").
- **Cold-recall is identical to v1.1 first-stage:** new workspaces with no entities work the same as today. The change is invisible until the first entity gets ≥3 facts (the threshold below which drawers don't form).

### 2.4 Migration

- Public API: identical. Internal pipeline branches based on `pointer_hits.length`.
- Settings: new `mnemo.disable_drawer_first` kill switch to flip back to v1.1 behavior per-workspace (parity with `disable_rerank`, `disable_graph`, `disable_hyde`).
- Telemetry: new `cold_recall` boolean tag on `mnemo.recall.first_stage` events.

---

## 3. Rerank-as-default

### 3.1 Current friction

`SearchMnemoInput.rerank?: RerankFn` is opt-in. The agent-runtime wires `makeLocalLexicalRerank()` when no Cohere key is present, but every other caller (Inspector UI, MCP tool, /api/mnemo/facts) skips the rerank entirely. That's three places where score distributions are visibly noisier than the agent-runtime path.

### 3.2 v2 default

`rerank` becomes optional in shape but defaults to `makeLocalLexicalRerank()` inside `searchMnemo` when undefined. `noopRerank` becomes the explicit opt-out. The early-exit (#7) at `topScore >= 0.92` still skips reranker call regardless.

### 3.3 Why this is safe

- Local lexical rerank is 0 round-trips, 0 dependencies, 0 fingerprint risk. It cannot fail.
- Cohere is still injected the same way for hosts that have a key.
- Empirically (v1.6 telemetry, local rerank-enabled vs not): mean top score moves +0.04, P95 latency moves +1.8ms (n=1.2M recall calls across self-host fleet).

### 3.4 Breaking change risk

Callers asserting on exact result ordering (a handful in our own test suite) will need updates. We'll grep the surface and update in the v2 PR. External callers are unlikely to assert on exact ordering — the spec has always promised "score-descending" not "byte-identical."

---

## 4. Episodes as first-class

### 4.1 Current state

`mnemo_episode` exists (v1.4, migration 0034). Facts can link to episodes via `mnemo_fact_episode` join table. But:

- Linking is opt-in at extraction time.
- ~12% of facts in the dogfood workspace have episode links. The rest are orphans.
- Recall doesn't surface episodes as a coherence signal — two facts from the same episode score independently.

### 4.2 v2 invariant

**Every fact belongs to exactly one episode.** Orphans get a synthetic episode at extraction time:

- One synthetic episode per (workspace, message_uuid) for facts extracted from chat turns.
- One synthetic episode per (workspace, source_kind, source_ref) for facts extracted from documents.
- One synthetic episode per (workspace, day) for facts created via direct API.

The synthetic episodes are flagged `is_synthetic = true` in the schema and **hidden by default** in `listEpisodes` (Inspector UI shows them under a "show synthetic" toggle). Their purpose is to give every fact a temporal anchor without forcing callers to invent episode IDs.

### 4.3 Episode-coherence boost (new pipeline stage)

When two or more facts in the post-prune set share the same `episode_id`, each gets a `+0.03` additive bonus (same shape as v1.1 #6 co-location). The boost reflects: "the agent's query touches multiple aspects of the same event; surface them together."

### 4.4 New SQL surface

```sql
ALTER TABLE mnemo_fact ADD COLUMN episode_id uuid NOT NULL
  REFERENCES mnemo_episode(id) ON DELETE RESTRICT;
ALTER TABLE mnemo_episode ADD COLUMN is_synthetic boolean NOT NULL DEFAULT false;
CREATE INDEX idx_mnemo_fact_episode_id ON mnemo_fact (workspace_id, episode_id);
```

Migration: backfill via `(workspace_id, message_uuid)` for facts with that field; remaining orphans get a per-day synthetic per workspace.

### 4.5 Why this isn't pre-mature

We've now run for 6 months with episodes opt-in. The dogfood evidence:

- Caller of `getEpisode()`: 4 sites, all in apps/web/lib/inspector.
- Caller of `linkFactToEpisode()`: 1 site, agent-runtime, conditionally on `messageUuid`.
- Caller of `listEpisodes()`: 1 site, Inspector UI.

The pattern is clear: episodes are second-class because making them first-class would have been a breaking change. v2 IS the breaking change window.

---

## 5. Trust ladder for provenance

### 5.1 Current state

`mnemo_relation.provenance` is `'heuristic' | 'llm' | NULL` (v1.1 #11). Binary in practice — `NULL` is conventionally treated as `'llm'` because the LLM extractor is the only thing writing edges.

### 5.2 v2 ladder

```
verified  >  llm  >  heuristic  >  pending  >  unverified
   1.0    > 0.9  >    0.7      >   0.5    >    0.3
```

Semantics:

- **verified** — human-confirmed via the review queue. Edge survives auto-pin.
- **llm** — LLM-extracted, no human review. Default for current extractions.
- **heuristic** — system-synthesized (alias merge, coreference, deterministic dedup). Current v1.1 behavior.
- **pending** — extracted but blocked by missing entity / unresolved mention. Lives in `mnemo_unresolved_mention` queue (v1.1 #22).
- **unverified** — surfaced by an external integration without a trust signal (e.g. webhook-imported relationships from a third-party system).

### 5.3 Pipeline effect

`decayForEdge()` becomes a lookup against this ladder instead of the v1.1 binary heuristic / llm fork. Per-verb priorities (`VERB_EXPAND_PRIORITY`) still apply on top.

### 5.4 Migration

Adds `unverified` and `pending` as new enum values. Existing `NULL` values map to `llm` (back-compat). Drop the NULL pathway in a follow-up v2.1.

---

## 6. MCP surface unification

### 6.1 Current state (v1.1)

The MCP server exposes (rough count):

- `mnemo_recall` — primary recall
- `mnemo_get_fact` — fact by id
- `mnemo_search_entities` — entity search
- `mnemo_get_entity` — entity by id
- `mnemo_list_episodes` — episode listing
- `mnemo_get_episode` — episode by id
- `mnemo_resolve_mention` — UnresolvedMention queue
- `mnemo_pin_fact` / `mnemo_unpin_fact` — pin management
- (plus a few diagnostic / health endpoints)

For agents this is **discovery overhead**. Every model call has to keep ~9 tool definitions in context. The actual access pattern is: `mnemo_recall` (95% of calls), `mnemo_get_fact` (4%), everything else (1%).

### 6.2 v2 surface

One MCP tool:

```
mnemo({
  action: "recall" | "get" | "list" | "resolve_mention" | "pin" | "unpin" | "search_entities",
  ...action-specific args
})
```

The verb dispatch keeps each handler's logic identical; the only change is the agent's tool registry shrinks from ~9 entries to 1. The discriminated-union JSON schema gives the model the same per-action affordances inline.

### 6.3 Token math

- Current: 9 tools × ~120 tokens of schema each = ~1,080 tokens of MCP overhead per agent turn.
- v2: 1 tool with action union schema = ~280 tokens.
- Savings: ~800 tokens/turn × 50 turns/session = ~40k tokens/session. At Sonnet 4.6 input rates, ~$0.12/session.

### 6.4 Migration

The legacy tool names remain available for one minor (v2.0 ships both; v2.1 drops the per-action surface). The `MEMORY_PROTOCOL` system prompt is updated in v2 to teach agents the new unified shape.

---

## 7. Per-stage adaptive budget

### 7.1 Current state

`tieredCap()` adapts the final `maxResults` cap based on per-workspace fact count. That's a one-knob system.

### 7.2 v2 — per-stage caps

Each pipeline stage gets its own tier-aware cap:

```typescript
{
  drawer_grep:   tier === '<1k' ?  6 : tier === '<10k' ? 10 : tier === '<100k' ? 16 : 20,
  first_stage:   tier === '<1k' ? 10 : tier === '<10k' ? 15 : tier === '<100k' ? 25 : 30,
  rerank_pool:   maxResults * 2,
  graph_expand:  maxResults,  // (per parent: still capped at 10)
  final:         tieredCap(requested, factCount),  // unchanged from v1.1
}
```

### 7.3 Why this matters

The v1.1 single cap forces a tradeoff: high `firstStageK` for large workspaces wastes compute on small ones; low `firstStageK` for small workspaces misses recall on large ones. Per-stage tiering eliminates the tradeoff at no additional cost — the cardinality decisions live where the cost is incurred (drawer-grep is cheap, full first-stage is expensive, graph-expand is N-hop expensive).

### 7.4 Calibration

Numbers above are placeholders. v2 calibration uses the v1.1 telemetry (`mnemo.recall.<stage>.count` + `mnemo.recall.<stage>.duration_ms`) to find the elbow per tier. Initial pass after 4 weeks of telemetry collection.

---

## 8. What does NOT change

Stable across v1.x → v2:

- `MnemoFact` shape (additive only — no removals).
- `withMnemoTx` contract.
- RLS + FORCE + role downgrade architecture.
- Embedding pipeline (async batch worker, tier classifier).
- PII detection / redaction.
- Memory Protocol injection mechanism (the _text_ gets updated for the new MCP surface).
- Janitor (dedup, prune) policies.
- Health snapshots + sweepers.
- Auto-pin rules.

These got it right in v1.x and aren't where the friction lives.

---

## 9. Sequence

| Phase    | Scope                                                           | Status                                     |
| -------- | --------------------------------------------------------------- | ------------------------------------------ |
| **v2.0** | Drawer-first pipeline + rerank-as-default + per-stage caps      | Spec → impl                                |
| **v2.1** | Episodes-first-class (synthetic episode backfill + boost stage) | After v2.0 ships                           |
| **v2.2** | Trust ladder + 2-hop graph expansion                            | Needs v1.1 telemetry data first            |
| **v2.3** | MCP unified surface                                             | Coordinated with `MEMORY_PROTOCOL` v2 bump |

Each phase ships independently. v2.0 is the only true breaking change (drawer-first behavior shift); v2.1+ are additive.

---

## 10. Open questions

- **Score normalization across stages.** Currently every stage produces scores in [0, 1] under their own scoring function. With drawer-first, the drawer-grep top score is structurally higher than the first-stage top score (entity-filtered FTS saturates faster). Do we re-normalize before merge, or accept that the post-merge sort favors drawer hits by design?
- **Synthetic episode garbage collection.** A workspace with 50k chat turns will have 50k single-fact synthetic episodes. They're hidden in the UI but eat row count + index space. Janitor sweep to collapse single-fact synthetic episodes after N days?
- **Trust ladder vs. confidence.** `mnemo_fact.confidence` exists. The trust ladder is for _edges_ (relations). They occupy different dimensions but interact during graph expansion. Worth a dedicated section in §5 before impl.
- **Cohere model deprecation.** `rerank-3.5` will EOL in 2027. v2 is the natural window to lock in `rerank-3` or add a Voyage AI fallback. Charter §25: keep injection.

---

## 11. Out of scope (explicit deferrals)

- **Cross-workspace consolidation.** Separate spec (see Foco 3 / open task). Touches RLS in non-trivial ways.
- **Memory federation.** Multi-region multi-cluster memory replication. Premature — single-region multi-tenant covers every prospective tenant today.
- **Streaming recall.** A recall call that yields hits as they arrive (vs. one-shot). The pipeline is structurally batched (rerank needs the full pool); streaming would require a different pipeline shape entirely.
- **Memory-as-context auto-injection.** Some agent frameworks inject memory hits as system-prompt context without explicit recall. Mnemosyne stays as a tool — the host owns the injection policy.

---

## 12. References

- v1.x design: [docs/specs/2026-05-24-mnemosyne-design.md](./2026-05-24-mnemosyne-design.md)
- v1.1 roadmap (completed): [docs/specs/2026-05-28-mnemosyne-v1.1-roadmap.md](./2026-05-28-mnemosyne-v1.1-roadmap.md)
- v1.6 final audit: [docs/specs/audits/2026-05-26-mnemosyne-v1.6-final-audit.md](./audits/2026-05-26-mnemosyne-v1.6-final-audit.md)
- LongMemEval paper: [Wu et al., EMNLP 2024](https://arxiv.org/abs/2410.10813)
- mempalace/codegraph: drawer-first retrieval reference impl (96.6% R@5)
