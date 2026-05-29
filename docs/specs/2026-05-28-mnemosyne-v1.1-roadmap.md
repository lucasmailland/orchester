# Mnemosyne v1.1 — Roadmap & Handoff

> **Para agentic workers:** Continuar implementación desde esta sesión.
> Usa `superpowers:subagent-driven-development` o `superpowers:executing-plans`.

**Contexto:** Mnemosyne v1.6 está shippeado (tag v1.0.0, main, GitHub Release).
Este doc captura el resultado de un audit de 29 mejoras identificadas en los
repos de referencia (Mem0 V3, mempalace/codegraph, Engram). Ninguna está
implementada todavía — todas son work de v1.1+.

**Package:** `packages/mnemosyne/src/`
**Host wiring:** `apps/web/lib/`

---

## Estado del codebase (v1.6 baseline)

### Pipeline de recall (search.ts)

```
L1 LRU (60s) → L3 query cache (cosine ≥ 0.95) → first-stage retrieval → rerank → prune → hard cap
```

- First-stage: **FTS OR vector** (nunca ambos simultáneamente)
- Scoring vector: `0.50·semantic + 0.15·recency + 0.10·frequency + 0.20·relevance + 0.05·pin`
- Scoring FTS: `0.6·fts + 0.2·recency + 0.1·frequency + 0.1·pin`
- Graph expansion: 1-hop via `mnemo_relation` con decay=0.7, todos los edges igual
- maxResults: default 3, cap 20, hardcoded (sin adaptive tiering)

### Extraction pipeline

- `extraction/prefilter.ts` → `shouldExtract()` → si rechaza, el turn se pierde para siempre
- `entity/extract.ts` → heuristic scan + optional LLM classification, greedy

### Memory dynamics

- `markRecalled()`: solo `hit_count + 1` y `last_recalled_at = now()`. Sin Hebbian.

### Graph / relations

- 9 verbs locked: related, compatible, scoped, conflicts_with, supersedes, not_conflict, derived_from, part_of, member_of
- Sin columna `provenance` en mnemo_relation
- Todos los hops tienen decay uniforme (0.7)

### Review queue

- `ReviewReason`: "low_confidence" | "contradiction" | "manual"
- El tipo 'contradiction' existe pero el wire desde conflict detection → enqueueReview no está conectado

### Summary

- `mnemo_summary`: sin `text_lemmatized`, sin `source_hash`, sin `last_verified_at`

---

## Audit de 29 ideas — resultado

### ✅ Implementadas completamente

_Ninguna._

### ⚠️ Parciales (2 de 3 componentes)

| #   | Idea                                            | Qué falta                                                                                                                                                                                                         |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | Hybrid BM25+vector en TODO recall path          | `search.ts`: el vector branch usa pure cosine, no combina con BM25. Necesita correr FTS **y** vector en paralelo y fusionar scores antes de rerank.                                                               |
| 12  | Inverted-interval rejected WRITE + dropped READ | READ: ya existe (`valid_to IS NULL OR valid_to > now()`). WRITE: `createRelation()` en `graph/relation.ts` no valida `valid_to < valid_from`.                                                                     |
| 24  | Advisory-only contradiction queue               | Queue y tipo existen. Falta: `conflict/candidate.ts` (o el fact-candidate equivalente) debe llamar `enqueueReview({ reason: 'contradiction' })` cuando detecta conflicto, en vez de solo crear pending relations. |

### ❌ No implementadas (26)

---

## Priorización por impacto/effort

### 🔥 S-tier — implementar primero (todas pequeñas, alto impacto)

**#3 — Hybrid BM25+vector**

- Effort: S (1-2 días)
- Impacto: Fix de un latent bug real. Queries de código/logs/diffs con pure cosine pueden fallar silenciosamente (embeddings de código son noisy).
- Archivo: `packages/mnemosyne/src/recall/search.ts` → función `runFirstStage()`
- Cambio: En el vector branch, también correr el FTS query y fusionar:
  `hybridScore = 0.7·semantic + 0.3·fts_normalized` antes del scoring final.

**#28 — MCP anti-pattern server-instructions**

- Effort: XS (30 minutos)
- Impacto: 30-50% menos tokens por sesión de agente con LLMs caros.
- Archivo: `apps/web/app/api/mcp/route.ts` (o donde se define el MCP server) → campo `server_instructions`
- Texto a agregar:
  ```
  IMPORTANT: Use mnemo_recall (or mnemosyne_recall) for ALL memory lookups.
  NEVER loop mnemo_get_fact in a sequence to retrieve multiple facts —
  that pattern is 10-50x more expensive and returns worse-ranked results.
  Always pass a natural-language query to mnemo_recall and let the system
  handle retrieval. Only call mnemo_get_fact when you have a specific
  fact ID from a prior recall result.
  ```

**#25 — Adaptive recall budget por tenant fact count**

- Effort: S (horas)
- Impacto: Fix de silent truncation para tenants nuevos y headroom real para tenants grandes.
- Archivo: `packages/mnemosyne/src/recall/search.ts` → `searchMnemo()`
- Lógica a agregar antes del pipeline:
  ```typescript
  // Count facts for workspace (cache en L1, TTL 5min)
  // <1k → maxResults = min(requested, 8)   (~8k chars budget)
  // <10k → maxResults = min(requested, 12)  (~16k chars)
  // <100k → maxResults = min(requested, 18) (~28k chars)
  // else → maxResults = min(requested, 20)  (~40k chars)
  ```

**#11 — Edge provenance column en mnemo_relation**

- Effort: S (migración + una línea de código)
- Impacto: Audit trail para enterprise. "¿Qué sabe el agente vs infirió?"
- Archivos:
  - `packages/db/migrations/0043_mnemo_relation_provenance.sql` (nueva migración)
  - `packages/mnemosyne/src/graph/relation.ts` → agregar `provenance: string | null` a la interfaz y al insert
  - `packages/mnemosyne/src/recall/search.ts` → el graph expansion query puede pesar heurísticas más bajo: `decay = input.expandDecay ?? (edge.provenance === 'heuristic' ? 0.5 : 0.7)`
- Schema:
  ```sql
  ALTER TABLE mnemo_relation ADD COLUMN provenance text DEFAULT NULL;
  CREATE INDEX idx_mnemo_relation_provenance ON mnemo_relation (workspace_id, provenance)
    WHERE provenance IS NOT NULL;
  ```
- Valores: NULL = LLM-derived, 'heuristic' = alias merge / coreference synthesized

**#4 — Single-term dampener**

- Effort: XS
- Archivo: `packages/mnemosyne/src/recall/search.ts` → después del scoring, antes de sort
- Código:
  ```typescript
  const contentWords = input.query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const isSingleTerm = contentWords.length === 1;
  if (isSingleTerm) {
    for (const h of scored) h.score *= 0.6;
  }
  ```

**#7 — Confidence-based early exit rerank**

- Effort: XS
- Archivo: `packages/mnemosyne/src/recall/search.ts` → `runSearchPipeline()` antes de llamar reranker
- Código:
  ```typescript
  const topScore = firstStage[0]?.score ?? 0;
  const rerankFn = topScore >= 0.92 ? noopRerank : (input.rerank ?? noopRerank);
  ```

**#8 — Per-entity diversity cap como % del budget**

- Effort: S
- Archivo: `packages/mnemosyne/src/recall/search.ts` → después de prunePostRecall, antes de expandGraph
- Código:
  ```typescript
  // Group by entity_id, cap each at max(2, ceil(maxResults * 0.15))
  const entityCap = Math.max(2, Math.ceil(maxResults * 0.15));
  ```

---

### 🏗️ M-tier — siguiente sprint (mayor impacto, requieren más trabajo)

**#10 — Hebbian potentiation + Ebbinghaus decay + Cepeda spacing**

- Effort: M (3-5 días)
- Impacto: El differentiator de marketing más importante. Convierte Mnemosyne de "DB con vectors" en "memoria cognitiva" real.
- Archivos a crear/modificar:
  - `packages/db/migrations/0043_mnemo_fact_memory_strength.sql`:
    ```sql
    ALTER TABLE mnemo_fact
      ADD COLUMN memory_strength float NOT NULL DEFAULT 1.0,
      ADD COLUMN memory_stability float NOT NULL DEFAULT 1.0,
      ADD COLUMN last_strength_update timestamptz DEFAULT NULL;
    ```
  - `packages/mnemosyne/src/recall/search.ts` → agregar `memory_strength` como señal en el scoring:
    `score = ... + 0.05 * clamp01(r.memory_strength / 5.0)`
  - `packages/mnemosyne/src/primitives/fact.ts` → actualizar `markRecalled()`:
    ```typescript
    const POTENTIATION_INCREMENT = 0.05;
    const STABILITY_INCREMENT = 0.1;
    const MAX_STRENGTH = 5.0;
    // Solo potentiar si gap >= 1h desde last_recalled_at
    // decay = max(0.05, old_strength * exp(-days_since_update / stability))
    ```

**#20 — Sweeper message-grain backfill**

- Effort: M (2-3 días)
- Impacto: No-data-loss. Turns rechazados por shouldExtract hoy se pierden para siempre.
- Archivos:
  - `apps/web/worker/mnemo-sweeper-job.ts` (nuevo)
  - Lógica: pg-boss job cursor-resumable keyed `(session_id, message_uuid)`, re-examina turns con threshold más bajo, skipea los que ya tienen facts extracted

**#1+2 — Pointer index + drawer-grep**

- Effort: M (3-5 días)
- Impacto: La combinación que da 96.6% R@5 en mempalace.
- Archivos: Requiere nuevo tier en el pipeline de recall. Mayor restructuración.

---

### 📊 L-tier — roadmap más largo

**#10 — Hebbian** (M): diferenciador de marketing
**#22 — Unresolved-mention queue**: CRM-style precision
**#26 + #27 — BFS prioritization + containment hops**: mejora graph traversal
**#29 — LongMemEval benchmark**: credibilidad pública

---

## Qué NO implementar todavía

- **#5** (multi-term multiplicative): necesita validación empírica primero
- **#6** (co-location boost gated por entity): requiere #11 (provenance) primero
- **#9** (signal-strength cutoff): necesita datos de calibración
- **#13** (virtual line numbering): requiere arquitectura de drawers (#1+#2) primero
- **#16** (source-scoped dedup 0.15): nicho, aplica solo a tenants con KB muy grande
- **#17** (quality-threshold interlock): YAGNI hasta que haya caller que necesite esto

---

## Archivos clave para orientarse

```
packages/mnemosyne/src/
  recall/
    search.ts       ← pipeline principal de recall (el más importante)
    rerank.ts       ← Cohere + noopRerank
    query-prep.ts   ← contextualize + HyDE
    unified.ts      ← memory + KB blended recall
    cache.ts        ← L1 LRU + L3 query cache
  primitives/
    fact.ts         ← createFact, markRecalled (Hebbian va acá)
    fact-async.ts   ← async embed path
  graph/
    relation.ts     ← createRelation (provenance column va acá)
    verbs.ts        ← 9 locked verbs
  entity/
    extract.ts      ← heuristic scan + LLM classification
    store.ts        ← findOrCreate
  conflict/
    candidate.ts    ← saveDecisionWithCandidates (contradiction → review queue wire)
    fact-candidate.ts ← saveFactWithCandidates
  janitor/
    dedup.ts        ← semantic dedup por cosine (union-find)
    prune.ts        ← prune por confidence/recency
  summary/
    store.ts        ← upsertSummary (staleness banners van acá)
  review/
    queue.ts        ← enqueueReview (tipo 'contradiction' existe, wire falta)

apps/web/lib/
  brain/
    extract-job.ts  ← host-side extraction pipeline wiring
    recall.ts       ← host-side recall wiring
  agent-tools/
    mnemosyne-remember.ts  ← tool handler
  worker/           ← jobs de pg-boss (sweeper nuevo va acá)

packages/db/migrations/
  0042_*.sql        ← última migración aplicada (halfvec)
  0043_*.sql        ← próxima (provenance, o Hebbian columns)
```

---

## Convenciones del proyecto

- Documentación: siempre en `docs/specs/`
- Migrations: `packages/db/migrations/XXXX_nombre.sql` + companion `.down.sql`
- Commits: 1 línea subject + 2-3 bullets body MAX
- Merge: squash-only (`gh pr merge --squash`)
- No push/merge a main sin autorización explícita del usuario

---

## Estado del repo al cerrar sesión

- Branch: `main`
- Último commit: `chore(docs): remove stale intermediate audits + completed impl plans`
- Working tree: limpio
- Tag: `v1.0.0` (GitHub Release publicado)
- Dev server: configurado, seed completo

**Para continuar:** leer este doc + empezar con el batch S-tier (#3, #28, #25, #11, #4, #7, #8).
