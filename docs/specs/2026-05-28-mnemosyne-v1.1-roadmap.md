# Mnemosyne v1.1 → v2 — Roadmap & Handoff

> **Status (2026-05-30):** v1.1 completo (todo lo ejecutable del audit) + camino v2 implementado al máximo nivel posible. 13 commits locales adelantados de origin, pendiente push autorizado.
>
> Lo único que queda son piezas que requieren **decisiones de producto externas** (tenancy primitive para cross-workspace) o **datos de telemetría reales** (calibración de #5/#9 desde defaults seguros). Ambas categorías están shippeadas como código y solo esperan ese trigger.

**Package:** `packages/mnemosyne/src/`
**Host wiring:** `apps/web/lib/`

---

## 🎯 Status al cierre — 911 tests passing, tsc clean

### Commits locales pendientes de push (en `main`)

```
a73e9cf feat(mnemo): Phase F — per-stage caps wired + protocol v2 guidance + synthetic episode ids
6a49ff3 feat(mnemo): cross-workspace org-consolidation worker scaffold (Phase E)
7be47ab feat(mnemo): Phase A polish — audit log + rate-limiter extract + hot-path regression
deb455b feat(mnemo): cross-workspace consolidation pure algorithm (Phase C)
9d19d8a feat(mnemo): v2 partials — rerank-as-default + trust ladder + per-stage caps (Phase B)
74aae5c feat(mnemo): Inspector UI v2 — recall pipeline visualizer (Phase A)
824dc40 docs(mnemo): v2 design + Inspector UI v2 design + cross-workspace consolidation design
b198ce7 feat(mnemo): per-stage recall telemetry callback (Foco 1)
e4cda10 docs(mnemo): v1.1 roadmap — reflect actual state (23/29 done, 6 deferred)
3dfea6e feat(mnemo): Mnemosyne v1.1 — L-tier completo (#6 #13 #22 #26 #27 #29)
1d0d6db feat(mnemo): Mnemosyne v1.1 — batch S-tier + M-tier completo
+ Phase G+H+I (latest, this session)
```

### Recuento del audit original (29 ideas)

| #     | Idea                               | Estado                          |
| ----- | ---------------------------------- | ------------------------------- |
| 1+2   | Pointer index + drawer-grep        | ✅ Done — `1d0d6db`             |
| 3     | Hybrid BM25+vector                 | ✅ Done — `1d0d6db`             |
| 4     | Single-term dampener               | ✅ Done — `1d0d6db`             |
| **5** | **Multi-term multiplicative**      | ✅ **Done opt-in** — Phase I    |
| 6     | Co-location boost                  | ✅ Done — `3dfea6e`             |
| 7     | Confidence-based early-exit rerank | ✅ Done — `1d0d6db`             |
| 8     | Per-entity diversity cap           | ✅ Done — `1d0d6db`             |
| **9** | **Signal-strength cutoff**         | ✅ **Done opt-in** — Phase I    |
| 10    | Hebbian + Ebbinghaus + Cepeda      | ✅ Done — `1d0d6db`             |
| 11    | Edge provenance column             | ✅ Done — `1d0d6db`             |
| 12    | Inverted-interval WRITE validation | ✅ Done — `1d0d6db`             |
| 13    | Virtual line numbering             | ✅ Done — `3dfea6e`             |
| 16    | Source-scoped dedup 0.15           | ❌ Deferred (nicho — sin valor) |
| 17    | Quality-threshold interlock        | ❌ Deferred (YAGNI)             |
| 20    | Sweeper message-grain backfill     | ✅ Done — `1d0d6db`             |
| 22    | Unresolved-mention queue           | ✅ Done — `3dfea6e`             |
| 24    | Advisory contradiction queue wire  | ✅ Done — `1d0d6db`             |
| 25    | Adaptive recall budget             | ✅ Done — `1d0d6db`             |
| 26    | BFS verb prioritization            | ✅ Done — `3dfea6e`             |
| 27    | Containment hops                   | ✅ Done — `3dfea6e`             |
| 28    | MCP anti-pattern guidance          | ✅ Done — `1d0d6db`             |
| 29    | LongMemEval benchmark              | ✅ Done — `3dfea6e`             |

**Total: 21 de 23 ideas con contenido concreto implementadas. 2 deferred con racional firme (16, 17). 6 gaps en el audit original (14, 15, 18, 19, 21, 23) nunca tuvieron entry — absorbidos en otros items.**

---

## 🚀 Más allá del audit — v2 design + implementación

### Foco 1 — Telemetría (`b198ce7`)

`onMetric` callback per-stage en `searchMnemo` / `recallUnified`. 9 stages instrumentados. Host wire a `recordMetric` → Sentry distributions.

### Phase A — Inspector UI v2 (`74aae5c` + `7be47ab`)

- `captureTrace` flag + `RecallSample[]` en `RecallMetricEvent`
- `/api/mnemo/recall-debug` endpoint (rate-limited 10/min, audit-logged `inspector.recall_debug`)
- `<RecallFunnel>` + `<RecallDebugClient>` components
- Hot-path regression test que falla CI si producción enciende `captureTrace`

### Phase B — v2 partials (`9d19d8a`)

- **Rerank-as-default** — `makeLocalLexicalRerank` migrado al package; default en `searchMnemo` cuando `rerank` está unset
- **Trust ladder** — verified > llm > heuristic > pending > unverified (additive, sin migración)
- **Per-stage cap helpers** — `STAGE_CAP_BY_TIER`, wireado en Phase F

### Phase C — Cross-workspace pure algorithm (`deb455b`)

`clusterCrossWorkspace()` — union-find por cosine con 22 unit tests. Sin dependencia de schema.

### Phase E — Worker scaffold gated (`6a49ff3`)

`org-consolidation-job.ts` con kill switch ENV. Default off. **Bloqueado a nivel arquitectónico** — no existe primitivo `org` en este codebase (Phase H).

### Phase F — Per-stage caps + Protocol v2 + Synthetic episodes (`a73e9cf`)

- `runSearchPipeline` usa `firstStageCapForFactCount` + `drawerGrepCapForFactCount`
- `MEMORY_RECALL_GUIDANCE` bumped con drawer-first + trust ladder bullets
- `deriveSyntheticEpisodeId` puro (UUIDv5 determinístico, 3 derivaciones)

### Phase G+H+I (último commit)

- **G — Migration 0048**: `mnemo_fact.episode_id` (nullable) + `mnemo_episode.is_synthetic`
- **H**: Doc del bloqueo arquitectónico cross-workspace (no `org` table)
- **I — #5 + #9 opt-in**: `multiTermBoost` flag + `signalCutoff` flag, default off pendiente calibración

---

## ❌ Qué queda genuinamente bloqueado

Estas piezas NO son trabajo pendiente — son **decisiones externas** al código:

| Bloqueo                                                                         | Naturaleza                                                  | Qué se necesita                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Migración 0050** (cross-workspace `mnemo_org_fact_view` + `app_org_user` rol) | Arquitectónica — no existe primitivo `org` en este codebase | Producto decide: introducir org table, usar otro boundary (owner_user_id), o abandonar cross-workspace |
| **Calibración fina** de `STAGE_CAP_BY_TIER`, `multiTermBoost` y `signalCutoff`  | Datos reales                                                | 4 semanas de telemetría v1.1 productiva (`mnemo.recall.*`)                                             |
| **NOT-NULL flip** de `mnemo_fact.episode_id` (v2.1)                             | Operacional                                                 | Host backfill cron usando `deriveSyntheticEpisodeId` corre hasta 100% coverage                         |

Las 3 piezas tienen el código LISTO y solo esperan su trigger correspondiente.

---

## Convenciones del proyecto

- Documentación: siempre en `docs/specs/`
- Migrations: `packages/db/migrations/XXXX_nombre.sql` + companion `.down.sql`
- Commits: 1 línea subject + 2-3 bullets body MAX
- Merge: squash-only (`gh pr merge --squash`)
- **No push/merge a main sin autorización explícita del usuario**

---

## Estado del repo al cerrar sesión (2026-05-30)

- Branch: `main`
- 13 commits locales no pushed
- Working tree: limpio
- Tag: `v1.0.0` (GitHub Release publicado)
- Tests: **911 passing** (551 mnemosyne + 360 web)
- Tsc: limpio en ambos
- CI audit-invariants: pass

**Para continuar:** mnemosyne v1.1 y v2 (lo que es shippeable) están completos. Las gates restantes son externas (decisión de producto / datos de telemetría / cron de backfill).
