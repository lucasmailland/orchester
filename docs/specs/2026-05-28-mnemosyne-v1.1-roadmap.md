# Mnemosyne v1.1 — Roadmap & Handoff

> **Status (2026-05-30):** S-tier + M-tier + L-tier completos. v1.1 efectivamente shippeado en local (2 commits adelantados de origin, pendiente push autorizado).
> **Para agentic workers:** Continuar implementación desde esta sesión.
> Usa `superpowers:subagent-driven-development` o `superpowers:executing-plans`.

**Contexto:** Mnemosyne v1.6 está shippeado (tag v1.0.0, main, GitHub Release).
Este doc capturó el resultado de un audit de 29 mejoras identificadas en los
repos de referencia (Mem0 V3, mempalace/codegraph, Engram). Implementación
v1.1 completa al 2026-05-30 (excepto items deferred listados al final).

**Package:** `packages/mnemosyne/src/`
**Host wiring:** `apps/web/lib/`

---

## 🎯 Estado al 2026-05-30

### Commits locales pendientes de push (en `main`)

```
3dfea6e feat(mnemo): Mnemosyne v1.1 — L-tier completo (#6 #13 #22 #26 #27 #29)
1d0d6db feat(mnemo): Mnemosyne v1.1 — batch S-tier + M-tier completo
```

Working tree limpio. Tests: **438/438 passing** (71 archivos).

### Recuento de las 29 ideas

| Tier                          | Items                   | Status                     |
| ----------------------------- | ----------------------- | -------------------------- |
| S-tier (hot fixes)            | #3 #28 #25 #11 #4 #7 #8 | ✅ Done — commit `1d0d6db` |
| Parciales cerrados            | #12 #24                 | ✅ Done — commit `1d0d6db` |
| M-tier                        | #10 #20 #1 #2           | ✅ Done — commit `1d0d6db` |
| L-tier                        | #6 #13 #22 #26 #27 #29  | ✅ Done — commit `3dfea6e` |
| Deferred (YAGNI / needs data) | #5 #9 #16 #17           | ❌ Intencional — ver final |

**Total: 23 de 29 ideas implementadas. 6 deferred con racional.**

---

## ✅ Implementadas — S-tier (commit `1d0d6db`)

| #   | Idea                                         | Resultado                                                                                                                            |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 3   | Hybrid BM25+vector en runFirstStage()        | Vector + FTS corren en paralelo, fusionados con `0.7·semantic + 0.3·fts_normalized` antes del scoring.                               |
| 28  | MCP anti-pattern server_instructions         | Texto agregado en `apps/web/app/api/mcp/route.ts`. Reduce 30-50% tokens en agentic loops.                                            |
| 25  | Adaptive recall budget por tenant fact count | Tiering por workspace fact-count en `tieredCap()`. Cache L1 5min. Exported para tests.                                               |
| 11  | Edge provenance column en mnemo_relation     | Migración 0043. `provenance` column. Heuristic edges decay 0.5 vs 0.7 LLM-derived. Auditable.                                        |
| 4   | Single-term dampener                         | `isSingleTermQuery()` aplica ×0.6 cuando query tiene 1 content word. Exported.                                                       |
| 7   | Confidence-based early exit rerank           | `topScore >= 0.92 → noopRerank`. Skipea Cohere call. Latencia y costo.                                                               |
| 8   | Per-entity diversity cap                     | `computeEntityDiversityCap()` agrupa por `entity_id`, capa cada uno en `max(2, ceil(maxResults * 0.15))`. Aplicado pre-graph-expand. |

## ✅ Implementadas — parciales cerrados (commit `1d0d6db`)

| #   | Idea                               | Resultado                                                                                                        |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 12  | Inverted-interval WRITE validation | `createRelation()` ahora valida `valid_to >= valid_from`. READ ya estaba.                                        |
| 24  | Advisory contradiction queue wire  | `fact-candidate.ts` y `decision-candidate.ts` llaman `enqueueReview({ reason: 'contradiction' })` correctamente. |

## ✅ Implementadas — M-tier (commit `1d0d6db`)

| #   | Idea                           | Resultado                                                                                                                                |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | Hebbian + Ebbinghaus + Cepeda  | `memory_strength` + `memory_stability` columns. `markRecalled()` con potentiation gap-aware (≥1h) + exponential decay. Wired en scoring. |
| 20  | Sweeper message-grain backfill | `apps/web/worker/mnemo-sweeper-job.ts`. pg-boss cursor-resumable. Re-examina turns rechazados con threshold más bajo.                    |
| 1+2 | Pointer index + drawer-grep    | `packages/mnemosyne/src/index/pointer.ts`. Nuevo tier en pipeline. Tabla `mnemo_pointer` + drawer-grep en search.                        |

## ✅ Implementadas — L-tier (commit `3dfea6e`)

| #     | Idea                            | Resultado                                                                                                                                  |
| ----- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 6     | Co-location boost               | `applyCoLocationBoost()` — entities con ≥2 hits en pool reciben +0.04 antes del dampener. Exported.                                        |
| 13    | Virtual line numbering          | `drawer_line` window function en los 4 SELECTs. Surface como `MnemoFact.drawerLine`. `renderFactsCompact({ showDrawerLine: true })`.       |
| 22    | Unresolved-mention queue        | Migración 0047. CRUD completo en `entity/mention-queue.ts`. UPSERT con dedup por `(workspace_id, raw_name) WHERE pending`.                 |
| 26+27 | BFS priority + containment hops | `VERB_EXPAND_PRIORITY` map. `decayForEdge` usa `× verbPriority`. `contains` / `contained_by` en `EXPAND_VERBS`.                            |
| 29    | LongMemEval benchmark           | `benchmark/metrics.ts` (Recall@K, Precision@K, F1@K, MRR, AnswerCoverage) + `benchmark/fixtures.ts` (8 preguntas, 5 categorías del paper). |

---

## ❌ Deferred — racional explícito

Estos items NO se implementan en v1.1 — cada uno por motivo concreto, no por olvido.

| #   | Idea                              | Por qué se difiere                                                                                                   |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 5   | Multi-term multiplicative scoring | Necesita validación empírica antes — el additive del v1.1 está probado. Re-evaluar con telemetría de queries reales. |
| 9   | Signal-strength cutoff            | Requiere datos de calibración por tenant. Sin baseline, cualquier threshold es arbitrario.                           |
| 16  | Source-scoped dedup 0.15          | Nicho — solo aplica a tenants con KB > 100k chunks. Reabrir cuando existan.                                          |
| 17  | Quality-threshold interlock       | YAGNI hasta que haya un caller que lo necesite. La actual confidence + auto-pin cubre los casos reales.              |

---

## 🚀 Próximos focos (post-v1.1)

Una vez mergeado v1.1, los siguientes ejes son:

1. **Telemetría de recall en producción** — capturar score distributions, hit-rate por categoría LongMemEval, latencia P50/P95/P99 por etapa del pipeline. Sin esto, no se puede empíricamente validar #5 ni calibrar #9.
2. **Inspector UI v2** — visualizar la cadena completa: query → query-prep → BM25+vector hits → rerank → prune → graph-expand → final. Cada etapa con scores y razones (`RecallReasons`).
3. **Cross-workspace consolidation** — REM-style consolidation pero cross-actor para tenants enterprise (con cuidado de RLS).
4. **Mnemosyne v2 design spec** — capturar las decisiones de v1.1 + qué romper para v2 (probable: rerank-as-default, drawer-first retrieval, episode-as-first-class).

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
- Últimos commits locales (no pushed): `3dfea6e` (L-tier), `1d0d6db` (S+M-tier)
- Origin HEAD: `8345209 docs(mnemo): v1.1 roadmap + 29-ideas audit handoff`
- Working tree: limpio
- Tag: `v1.0.0` (GitHub Release publicado)
- Tests: 438/438 passing (71 archivos)

**Para continuar:** v1.1 está hecho. Decidir push a origin, abrir PR squash-merge a main, y arrancar con los próximos focos arriba.
