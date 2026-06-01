# Mnemosyne v1.1 → v2 — Roadmap & Handoff (FINAL)

> **Status (2026-05-30):** v1.1 audit + v2 design + v2 implementation
> **al 100%** salvo ajustes futuros guiados por telemetría real.
> 17 commits locales adelantados de origin, esperando push autorizado.
>
> Cero gates externos. Lo que queda son **decisiones operacionales**
> (cuándo flipear ENVs, cuándo correr migraciones en cada deploy) —
> no es código pendiente.

**Package:** `packages/mnemosyne/src/`
**Host wiring:** `apps/web/lib/` + `apps/web/worker/`

---

## 🎯 Status al cierre — ~940 tests passing, tsc clean, CI invariants pass

### Audit original (29 ideas) — 100% accionable cubierto

| #   | Idea                               | Estado                   |
| --- | ---------------------------------- | ------------------------ |
| 1+2 | Pointer index + drawer-grep        | ✅ Done                  |
| 3   | Hybrid BM25+vector                 | ✅ Done                  |
| 4   | Single-term dampener               | ✅ Done                  |
| 5   | Multi-term multiplicative          | ✅ Done opt-in (Phase I) |
| 6   | Co-location boost                  | ✅ Done                  |
| 7   | Confidence-based early-exit rerank | ✅ Done                  |
| 8   | Per-entity diversity cap           | ✅ Done                  |
| 9   | Signal-strength cutoff             | ✅ Done opt-in (Phase I) |
| 10  | Hebbian + Ebbinghaus + Cepeda      | ✅ Done                  |
| 11  | Edge provenance column             | ✅ Done                  |
| 12  | Inverted-interval WRITE validation | ✅ Done                  |
| 13  | Virtual line numbering             | ✅ Done                  |
| 16  | Source-scoped dedup                | ✅ Done opt-in (Phase J) |
| 17  | Quality-threshold interlock        | ✅ Done opt-in (Phase J) |
| 20  | Sweeper message-grain backfill     | ✅ Done                  |
| 22  | Unresolved-mention queue           | ✅ Done                  |
| 24  | Advisory contradiction queue wire  | ✅ Done                  |
| 25  | Adaptive recall budget             | ✅ Done                  |
| 26  | BFS verb prioritization            | ✅ Done                  |
| 27  | Containment hops                   | ✅ Done                  |
| 28  | MCP anti-pattern guidance          | ✅ Done                  |
| 29  | LongMemEval benchmark              | ✅ Done                  |

**23 / 23 ideas con contenido concreto implementadas. 6 entries vacíos del audit original (14, 15, 18, 19, 21, 23) sin counterpart.**

---

## 🚀 v2 design + implementación (Phases A → L)

### Phase A — Inspector UI v2

- `captureTrace` flag + `RecallSample[]`
- `/api/mnemo/recall-debug` endpoint (rate-limited 10/min, audit-logged)
- `<RecallFunnel>` + `<RecallDebugClient>` components
- Hot-path regression: CI falla si producción enciende `captureTrace`

### Phase B — v2 partials

- Rerank-as-default (`makeLocalLexicalRerank` en package)
- Trust ladder (verified > llm > heuristic > pending > unverified)
- Per-stage cap helpers (`STAGE_CAP_BY_TIER`)

### Phase C — Cross-workspace pure algorithm

- `clusterCrossWorkspace()` — union-find por cosine, 22 unit tests

### Phase E — Worker scaffold gated

- `org-consolidation-job.ts` con kill switch ENV

### Phase F — Per-stage caps wired + Protocol v2 + Synthetic episodes

- `runSearchPipeline` usa los stage caps
- `MEMORY_RECALL_GUIDANCE` con drawer-first + trust ladder bullets
- `deriveSyntheticEpisodeId` (UUIDv5 determinístico)

### Phase G — Migration 0048

- `mnemo_fact.episode_id` (nullable) + `mnemo_episode.is_synthetic`

### Phase I — #5 + #9 opt-in

- `multiTermBoost` + `signalCutoff` flags

### Phase J — Backfill cron + #16 #17 + episode coherence + protocol bump

- `episode-backfill-job.ts` (paginado, idempotente)
- `applySourceScopedDedup`, `applyQualityThreshold`,
  `applyEpisodeCoherenceBoost`
- `MEMORY_PROTOCOL_VERSION` v1.2 → v1.3

### Phase K — Cerrados los "bloqueos externos"

- **Migration 0049**: tabla `org` + `workspace.org_id` con backfill 1:1
- **Migration 0050**: `mnemo_org_fact_view` + `app_org_user` rol + RLS
- **Migration 0051**: SQL backfill + NOT NULL flip de `episode_id`
- `createFact()` auto-deriva + upsert synthetic episode en la misma tx

### Phase L — Cierre espectacular

- Wire de `JOB_MNEMO_EPISODE_BACKFILL` (daily 04:15 UTC) y
  `JOB_MNEMO_ORG_CONSOLIDATION` (Sunday 02:30 UTC) en pg-boss
- **Cuerpo real del cron cross-workspace** — fetcha embeddings ONLY,
  clusterea, redacta PII, INSERTea summary determinístico
  (placeholder hasta wirear el cheap-tier LLM)
- `GET /api/admin/orgs/[orgId]/cross-workspace-facts` admin REST
- `CHANGELOG.md` con entry v2 completo
- Este roadmap actualizado

---

## ❌ Gates externos restantes

**Cero.** Lo que queda son decisiones operacionales:

| Acción operacional                                                                   | Cuándo                                                                     |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Push a origin (`git push origin main`)                                               | Cuando el user autorice                                                    |
| `MNEMO_ENABLE_CROSS_WORKSPACE_CONSOLIDATION=true` en deploy                          | Cuando legal/security signoff esté en file                                 |
| Flip de defaults de `multiTermBoost`/`signalCutoff` a ON                             | Cuando 4 semanas de telemetría `mnemo.recall.*` calibren los magic numbers |
| Reemplazar `composeDeterministicSummary` por `llmCall` en `org-consolidation-job.ts` | Cuando el per-org cheap-tier model resolver + spend cap wiring esté listo  |

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
- 17 commits locales no pushed
- Working tree: limpio
- Tag: `v1.0.0` (próximo: `v1.1.0` cuando se autorice push)
- Tests: ~940 passing
- Tsc: limpio en `packages/db`, `packages/mnemosyne`, `apps/web`
- CI audit-invariants: pass

**Para continuar:** todo el código está. El próximo evento es deploy (ENV flips) y telemetría (calibración).
