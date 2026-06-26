# Brain Graph — Analytics Rework, UX Fixes & Rich Demo Seed

> **Status:** Implemented & verified · **Date:** 2026-06-26 · **Scope:** `apps/web` (orchester) + local demo data
> **Commits (code):** [`111d7eb`](https://github.com/lucasmailland/orchester/commit/111d7eb) (analytics rework) + [`892f70d`](https://github.com/lucasmailland/orchester/commit/892f70d) (focus banner, conversation detail page, this spec) — both on `origin/main`.
> **Related:** `docs/superpowers/plans/2026-06-04-memory-graph.md` (the original graph plan — this spec supersedes its renderer section).

This spec documents the brain-graph work done in the 2026-06-25/26 session: narrowing the renderer set, adding a renderer-agnostic analytics layer (communities + centrality), wiring it into ECharts, a focus-mode exit affordance, and a rich, reversible demo seed that gives every node real descriptions, facts and citation sources.

---

## 1. Renderer narrowing (6 → 2)

The graph briefly shipped **six** renderers behind a toggle. After an audit + product call ("me gusta la estética de ECharts, no la de Sigma"), the set was narrowed to two:

| Kept                      | What                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **ECharts** (default, 2D) | `graph` force series, Obsidian-style `emphasis.focus: 'adjacency'`, glow, relation-coloured edges. Now also the analytics consumer (§3). |
| **3D**                    | `react-force-graph-3d` (Three.js) — real 3D force graph with text sprites + directional particles.                                       |

**Removed:** Cytoscape (fcose), Sigma (WebGL + ForceAtlas2), G6.
**Deps removed:** `cytoscape cytoscape-fcose @antv/g6 sigma graphology-layout-forceatlas2 @types/cytoscape`.
**Deps added:** `graphology-communities-louvain graphology-metrics` (`graphology` itself kept).

**Gotcha preserved:** `react-force-graph` (3D) **mutates** `link.source/.target` from id strings into node objects on the shared array. ECharts therefore consumes a string-normalised copy (`normalizedLinks` memo in `BrainGraph.tsx`) or it crashes with `nonexistent source [object Object]`.

---

## 2. Analytics layer — `apps/web/lib/memory/graph-analytics.ts`

Pure, renderer-agnostic module over `graphology`. Single entry point:

```ts
computeGraphAnalytics(nodes: {id}[], links: {source, target, confidence?}[]): {
  byId: Map<string, { community: number; centrality: number; centralityRaw: number }>;
  communityCount: number;   // Louvain
  modularity: number;       // 0..1, >0.3 = real clustering
  ranked: string[];         // node ids by centrality desc — drives the top-N cap
}
```

- **Communities** — Louvain (`graphology-communities-louvain` → `louvain.detailed`). Colours via `COMMUNITY_COLORS` palette + `communityColor(i)`.
- **Centrality** — PageRank (`graphology-metrics/centrality/pagerank`), normalised to the most-central node (`centrality` ∈ 0..1).
- **Graph model** — undirected, non-multi; **parallel relations accumulate as edge weight (= confidence)**; self-loops & dangling-link endpoints skipped.
- **Guards** — empty graph → empty result; edge-less graph → each node its own singleton community + uniform PageRank.

**Verification:** unit-tested via `tsx` on known graphs (two-triangle → 2 communities, modularity ≈ 0.357; star → hub centrality = 1.0 ranked #1; degenerate inputs don't throw). Run on the **real demo graph** (60 nodes / 120 relations) it finds **6 communities, modularity 0.452**:

| Community | Theme                       | Examples                                                                   |
| --------- | --------------------------- | -------------------------------------------------------------------------- |
| 1 (19)    | App stack                   | Orchester, Nueno, Next.js, Better Auth, Drizzle, Tailwind, SWR             |
| 2 (14)    | Platform / infra / security | Mnemosyne, PostgreSQL, RLS, Workspace, GDPR, Docker, OrbStack              |
| 3 (14)    | Cognitive memory model      | Recall, Consolidación, Capture, Memory Strength, Decay, TD-λ, Sleep Cycles |
| 4 (5)     | Pixel / e-commerce          | Pixel, Medusa v2, Node 22, Stripe, Redis                                   |
| 5 (4)     | Vector search               | Embeddings, pgvector, HNSW, halfvec                                        |
| 6 (4)     | People / tooling            | Lucas, GitHub, Claude Code, Anthropic                                      |

This is the value vs colour-by-type: ~49/60 nodes are `Concepto`, so **Tipo** paints them one colour; **Comunidad** splits the blob into legible themes.

---

## 3. ECharts wiring — `apps/web/components/brain/graph/BrainGraphECharts.tsx`

`BrainGraph` memoises `analytics` over the visible graph and passes it down. ECharts then:

- **Node size by importance** — `symbolSize = 9 + sqrt(centrality) * 38` (sqrt spreads the long tail). Falls back to `12 + (val/max)*34` (mentions+degree) when analytics absent.
- **Colour mode** — `colorMode: "kind" | "community"`, surfaced as a **"Colorear: Tipo · Comunidad"** toggle (only in ECharts). `kind` → `ENTITY_KIND_COLOR`; `community` → `communityColor(analytics.community)`. Semantic edge styles (conflict/part_of/member_of) are preserved in both modes.
- **Label declutter** — labels shown at rest only for `centrality >= 0.28` (hubs); leaves reveal on hover.
- **Scalability cap** — `NODE_CAP = 350`. Above it, only the top-N most-central nodes render (plus the selected node + search hits), with a `shown / total` badge overlay. Keeps the look instead of falling back to `graphGL`. (Inactive on the 60-node demo by design.)

---

## 4. Focus-mode exit banner — `BrainGraph.tsx`

Entering "local graph" mode is a navigation (`?focus=<id>` → server returns the 1-hop neighbourhood), and there was **no in-app way out** (only browser-back / URL edit). Added a banner that renders whenever `focusEntityId` is set:

`🎯 {focus.title} · <entity> · [ {focus.exit} ]` → `router.push(/<locale>/<ws>/brain/graph)` clears the focus.

Positioned **top-center on its own row (`top-16`)** so it never overlaps the renderer / colour toggles (which live at `top-4`, right-anchored and slide with the detail drawer).

**i18n added** (`es/en/pt`): `brain.graph.colorBy.{kind,community,hint}` and `brain.graph.focus.{title,exit}`.

> Status: implemented + `tsc`/`next lint` green; shipped in `892f70d` on `origin/main`.

---

## 5. Rich demo seed (data, not code)

Goal: every node should show **real descriptions, real facts, and real sources** — not "Demo memory about X" / "Aún no hay citas". This is **local DB data**, reversible, and never committed to git.

### 5.1 Citation model (why two DBs)

`GET /api/mnemo/facts/[id]/citations` is **hybrid**: `@mnemosyne/client-ts.getFactCitations()` returns only `source_message_ids` (message is host-domain); orchester then JOINs its **own** `message` + `conversation` tables, scoped by `conversation.workspace_id = ctx.workspace.id`. So a populated FUENTES panel requires **both**:

- **mnemo** (`mnemo/mnemo` @ `:55434`, container `mnemosyne-postgres`) — `mnemo_fact.source_message_ids` set + real `statement`; `mnemo_entity.description` set.
- **orchester** (`orchester/orchester` @ `:5432`, `orchester-postgres`) — `conversation` + `message` rows in workspace **`tvlds3k623us6sz7zp2ek6gh`** (the orchester acme-inc id — NOT the mnemo `bd293fa7…` id) whose ids match the facts' `source_message_ids`.

**Deep-link side-effect (fixed):** the FUENTES card's "Abrir conversación" links to `/<locale>/<ws>/conversations/<id>#message-<msgId>`. That **conversation detail route did not exist** (only the inbox list page + the `/api/conversations/[id]` API), so the link **404'd** once FUENTES was populated. Fixed by adding the server-rendered detail page (§8) that mirrors the API's workspace-scoped query and scrolls to / highlights the cited message via CSS `:target`. `CitationsList`'s href was already correct — only the route was missing.

### 5.2 What was seeded (verified live)

| Item                                                  | Count     |
| ----------------------------------------------------- | --------- |
| `mnemo_entity` with real `description`                | 60 / 60   |
| `mnemo_fact` with real `statement` (no "Demo memory") | 103 / 103 |
| `mnemo_fact` with non-empty `source_message_ids`      | 103       |
| orchester `conversation` (`conv_gdemo_*`)             | 7         |
| orchester `message` (`msg_gdemo_*`)                   | 76        |

Facts = 60 primary (`mfact_gdemo_ment_gdemo_<slug>`) + 30 Mnemosyne pagination extras (`mfact_gdemo_mnemo_N`) + 13 hub extras (`mfact_gdemo2_<slug>`, second memory on Mnemosyne/Orchester/RLS/Conversations/ECharts/pgvector/Recall/Agents/Channels/Capture/Pixel/Memory Strength/…). Content is grounded in the real stack (RLS, hybrid recall, HNSW, TD(λ), the Orchester stack, Pixel, Nueno). Markers: entities/facts `metadata->>'seed'='graph-demo-2026'`; conversations/messages carry `conv_gdemo_`/`msg_gdemo_` id prefixes.

Generator (idempotent, emits both SQL files): session scratchpad `gen-rich-seed.cjs` → `orchester.sql` + `mnemo.sql`.

### 5.3 Reversibility (undo)

mnemo DB (`:55434`):

```sql
DELETE FROM mnemo_fact     WHERE id LIKE 'mfact_gdemo2_%';                 -- hub extras
DELETE FROM mnemo_fact     WHERE workspace_id='bd293fa7-cc0d-4773-b3c4-c241599b109b' AND metadata->>'seed'='graph-demo-2026';
DELETE FROM mnemo_episode  WHERE id='mepi_gdemo_strength';
DELETE FROM mnemo_relation WHERE workspace_id='bd293fa7-cc0d-4773-b3c4-c241599b109b' AND provenance='graph-demo-2026';
DELETE FROM mnemo_entity   WHERE workspace_id='bd293fa7-cc0d-4773-b3c4-c241599b109b' AND metadata->>'seed'='graph-demo-2026';
```

orchester DB (`:5432`):

```sql
DELETE FROM message      WHERE id LIKE 'msg_gdemo_%';
DELETE FROM conversation WHERE id LIKE 'conv_gdemo_%';
```

---

## 6. Production build verification

`next build` (webpack, `output: standalone`) verified **green in an isolated git worktree** (so the live `:3333` dev server was untouched): `✓ Compiled successfully in 39.2s`, 66/66 static pages, standalone output, `/api/workspaces/[slug]/brain/graph` route emitted, **no instrumentation / boot-500 regression**. The `next start` switch was deferred (kept on `next dev` for HMR).

**Build-order gotcha (documented):** a fresh clone/worktree `next build` fails on `@mnemosyne/client-ts` because the vendored SDK's `dist/` is snapshotted empty by the first `pnpm install` (the `prepare` hook builds it _after_ install). CI/Docker run `bootstrap-vendor.sh` **before** install, so production is unaffected. See memory `orchester_vendor_sdk_build_order`.

---

## 7. Verification summary

| Check                             | Result                                             |
| --------------------------------- | -------------------------------------------------- |
| `tsc --noEmit` (apps/web)         | clean                                              |
| `next lint`                       | clean                                              |
| `pnpm i18n:check`                 | 1400 keys, all present in en/es/pt                 |
| Analytics unit tests (`tsx`)      | pass (communities + centrality + degenerate cases) |
| Community detection on real graph | 6 communities, modularity 0.452                    |
| Citation JOIN (live)              | resolves to real message content                   |
| Prod build (isolated worktree)    | green (39.2s, 66/66 pages)                         |

---

## 8. File map

- `apps/web/lib/memory/graph-analytics.ts` — analytics layer (new).
- `apps/web/components/brain/graph/BrainGraphECharts.tsx` — size/colour/cap wiring.
- `apps/web/components/brain/graph/BrainGraph.tsx` — analytics memo, colorMode toggle, focus banner.
- `apps/web/messages/{es,en,pt}.json` — `brain.graph.colorBy.*`, `brain.graph.focus.*`.
- `apps/web/app/[locale]/[workspaceSlug]/(shell)/conversations/[id]/page.tsx` — conversation detail / thread view (new; fixes the citation "Abrir conversación" 404, §5.1).
- **Removed:** `BrainGraphCytoscape.tsx`, `BrainGraphSigma.tsx`, `BrainGraphG6.tsx`, `cytoscape-fcose.d.ts`.
- **Data (not in git):** local mnemo + orchester DBs (see §5).
