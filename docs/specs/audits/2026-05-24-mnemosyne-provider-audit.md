# Mnemosyne Provider Audit — Brain Core v1.1

**Date:** 2026-05-24 · **Status:** In progress

## Goal

Audit all code in `apps/web/lib/brain/*` against Mnemosyne Charter §25 (Provider Agnosticism). Identify and document every provider-specific assumption (defaults, hardcoded model names, provider-only optimizations) that must be refactored before migration to `packages/mnemosyne`.

## Findings

### Hardcoded provider references

Grep methodology (see Task 0.2):

```bash
grep -niE "openai|anthropic|claude-|gpt-|gemini|haiku|sonnet|mistral|cohere" apps/web/lib/brain/*.ts
grep -niE "text-embedding-3|voyage|nomic-embed" apps/web/lib/brain/*.ts
grep -niE "OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY" apps/web/lib/brain/*.ts
```

Total findings: 4 (2 BLOCKING, 0 WARN, 2 OK-as-example). No hardcoded provider env-var references found in `brain/`.

#### F-001 · apps/web/lib/brain/extract.ts:74

**Code:** `const model = input.model ?? "claude-haiku-4-5";`
**Type:** Default fallback model hardcoded — Anthropic SKU.
**Severity:** BLOCKING — Charter §25 rule 1 (no default model strings; resolve from workspace settings).
**Fix:** Replace with `input.model ?? workspace.mnemo.small_model` resolved at the call site (caller is `extract-job.ts:runBrainExtractJob`). Use existing `getWorkspaceSetting()` helper, or accept an explicit `model` arg from the caller (preferred — keeps `extract.ts` pure).

#### F-002 · apps/web/lib/brain/embed.ts:45

**Code:** `const provider = input.provider ?? "openai";`
**Type:** Default fallback provider hardcoded.
**Severity:** BLOCKING — Charter §25 rule 1.
**Fix:** Remove default; require caller to pass `provider` explicitly (the workspace setting `mnemo.embedding_provider` is the source of truth, resolved in the primitive that owns the embed call — `recall/embed.ts` in Mnemosyne). If `provider` is undefined, return `[]` (Mode A) rather than silently picking OpenAI.

#### F-003 · apps/web/lib/brain/embed.ts:46

**Code:** `const model = input.model ?? "text-embedding-3-small";`
**Type:** Default fallback embedding model hardcoded — OpenAI SKU.
**Severity:** BLOCKING — Charter §25 rule 1.
**Fix:** Remove default; same approach as F-002 — caller resolves from `workspace.mnemo.embedding_model`.

#### F-004 · apps/web/lib/brain/extract.ts:4 (and line 50 comment)

**Code:** `// Uses a cheap model (haiku/4o-mini) with a fixed system prompt;` (line 4); `/** Model identifier to use; defaults to haiku-like cheap model. */` (line 50)
**Type:** Comment-only reference; documentary, not load-bearing.
**Severity:** OK-as-example — Charter §25 explicitly permits provider names in comments/examples ("haiku/4o-mini" describes the role, not a hard dependency).
**Fix:** Optional cleanup during Phase 1 rename — reword to "Uses the workspace's configured `mnemo.small_model` (cheap tier)" for clarity.

#### F-005 · apps/web/lib/brain/extract.ts:30 (SYSTEM_PROMPT block, indirect)

**Code:** The SYSTEM_PROMPT string itself does not contain provider names — `grep` only flagged its surrounding context via the regex on `extract.ts`. Verified by reading the prompt (lines 30-43): no provider/model strings in the prompt.
**Type:** False-positive on the grep — no actual finding.
**Severity:** OK-as-example.
**Fix:** None.

### Provider-specific behaviors

Grep methodology (see Task 0.3):

```bash
grep -niE "cache_control|prompt_cache_key|reasoning_effort|response_format" apps/web/lib/brain/*.ts
grep -nE "llmCall\(" apps/web/lib/brain/*.ts
```

Total findings: 1 `llmCall` call in `extract.ts`. Zero direct provider-API constructs (`cache_control`, `prompt_cache_key`, `reasoning_effort`, `response_format`, `tool_choice`, `function_call`, streaming) — `brain/` delegates all provider dispatch through `lib/llm-call.ts`, which already routes by `resolveModel(model)` and is the canonical provider-agnostic seam in the codebase.

#### B-001 · apps/web/lib/brain/extract.ts:78 — single `llmCall` invocation

**Code:**

```ts
const result = await llmCall({
  workspaceId: input.workspaceId,
  model,
  systemPrompt: SYSTEM_PROMPT,
  messages: [
    {
      role: "user",
      content: `Extract durable facts from this conversation:\n\n${userContent}\n\nReturn JSON array now.`,
    },
  ],
  temperature: 0.1,
  maxTokens: 600,
});
```

**Provider features it relies on:**

- **None unique to any one provider.** The shape `{ systemPrompt, messages, temperature, maxTokens }` is universal across Anthropic, OpenAI, Gemini, Mistral, Groq, Ollama and is normalized by `llmCall` / `resolveModel`.
- **JSON output via prompting only** — no `response_format: "json_object"`, no `tool_choice`, no function/tool calling. The prompt instructs "Output ONLY a JSON array" and `extract.ts` strips ```code fences post-hoc (lines 113-117). This works on every provider; it does NOT depend on Anthropic/OpenAI native JSON mode.
- **No streaming.** Single block call. Works on every provider (Ollama included).
- **No prompt-caching directives** (`cache_control`, `prompt_cache_key`). The SYSTEM_PROMPT is small (~600 chars) so caching is not implemented at this layer — Mnemosyne Cost Tier 1 can opt-in later via adapter-level cache hints (Mode C only).

**Would it fail with a provider that lacks those features?** No. The call is the lowest-common-denominator chat completion.

**Required adapter interface methods to make it Mnemosyne-compliant:**

| Capability                                     | Adapter method                                               | Already in `llmCall`?                |
| ---------------------------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| Chat completion (block)                        | `adapter.chat({ system, messages, temperature, maxTokens })` | Yes (universal)                      |
| Token usage accounting                         | result.tokensUsed                                            | Yes                                  |
| Resolved model echo (for fallback attribution) | result.model                                                 | Yes                                  |
| Spend cap pre-flight                           | `assertWithinSpend(workspaceId, tx)`                         | Yes (separate call before `llmCall`) |
| Usage recording                                | `recordAiUsage()`                                            | Yes (separate call after `llmCall`)  |

**Verdict:** B-001 is OK-as-is. No provider-specific behavior to refactor — `extract.ts` is already the model the Mnemosyne charter wants (delegates to a single seam, no inline API knobs). The only adjustment for Mnemosyne is purely cosmetic (rename to `mnemosyne_extract`) plus passing the resolved `model` argument from the caller (covered by F-001).

#### B-002 · Indirect dependency on `wrapUntrusted` (lines 10, 73)

**Code:** `import { wrapUntrusted } from "@/lib/agent-runtime";` and `wrapUntrusted(input.conversationSlice, "conversation")`.
**Provider features:** None. `wrapUntrusted` is a pure prompt-injection guard that wraps content in untrusted-content fence markers. Provider-neutral.
**Verdict:** OK-as-is. Carry over to `packages/mnemosyne` unchanged (re-export from `@orchester/web/lib/agent-runtime` or copy if it must be in the package — TBD by Phase 1).

#### B-003 · Indirect dependency on `calculateChatCostUsd` (line 14, 97)

**Code:** `import { calculateChatCostUsd } from "@/lib/pricing";` and `const costUsd = calculateChatCostUsd(result.model, 0, tokensUsed);`
**Provider features:** Provider-agnostic — uses the project's `pricing` table keyed by `(provider, model)`.
**Verdict:** OK-as-is. The function is the canonical cost lookup; Mnemosyne should not duplicate it.

### Mode A compatibility gaps

Grep methodology (see Task 0.4):

```bash
grep -nE "embedBrain|llmCall|recordAiUsage" apps/web/lib/brain/*.ts
```

#### A/B/C requirement classification

| Function              | Brain file:line                         | Requires for Mode A (no AI)                                 | Requires for Mode B (embeddings only)                | Requires for Mode C (full AI)                        |
| --------------------- | --------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `embedBrain`          | embed.ts:44                             | **N/A — must short-circuit to `[]`**                        | Embedding provider + model required (workspace pref) | Same as Mode B                                       |
| `createFact`          | store.ts:55                             | nullable embedding (skip `embedBrain` call when no config)  | embedding provider                                   | + LLM extraction call (via caller `extractFacts`)    |
| `updateFact`          | store.ts:161                            | skip re-embed on statement change                           | embedding provider                                   | embedding provider                                   |
| `searchBrain`         | recall.ts:69                            | **FTS fallback** (use `text_lemmatized` GIN index)          | embedding provider                                   | + inference engine (Decision Layer / Mnemosyne v1.0) |
| `extractFacts`        | extract.ts:67                           | **N/A (skip — return `[]`)**                                | **N/A (skip — return `[]`)**                         | LLM provider required (`llmCall`)                    |
| `runBrainExtractJob`  | extract-job.ts:27                       | **N/A (skip — `enqueueBrainExtract` must no-op in Mode A)** | **N/A (skip)**                                       | LLM provider required                                |
| `recordAiUsage`       | extract.ts:13 (indirect, extract.ts:98) | **N/A — no AI call to record**                              | **N/A** (no embeddings recorded as `chat`)           | Required — records `capability='chat'` usage event   |
| `enqueueBrainExtract` | extract-job.ts:169                      | **N/A (skip — short-circuit to no-op)**                     | **N/A (skip)**                                       | Required — fires JOB_BRAIN_EXTRACT into pg-boss      |

#### Mode A BLOCKING gaps

The following functions in `brain/` have **no non-LLM/non-embedding fallback path** today and will need explicit Mode A handling in Mnemosyne:

##### M-A-001 · `embedBrain` (embed.ts:44) — silently picks OpenAI default

**Current behavior:** `provider = input.provider ?? "openai"` + `model = input.model ?? "text-embedding-3-small"`. Calls `embedRaw()` which will throw if the workspace has no OpenAI key configured.
**Mode A gap:** No detection of "embedding capability unavailable". The function will throw a 401 / config error instead of returning `[]`.
**Severity:** BLOCKING for Mode A.
**Fix locus:** Phase 1, in `packages/mnemosyne/src/recall/embed.ts` — wrap with a `detectMode(workspaceId)` check; in Mode A, return `[]` and let upstream callers (recall, createFact) handle the empty result.

##### M-A-002 · `searchBrain` (recall.ts:69) — no FTS fallback when embedding unavailable

**Current behavior:** Line 84 calls `embedBrain` for the query; line 90 `if (!queryVec) return []` returns empty when embedding is missing/empty. The SQL on line 99-118 hard-requires `embedding IS NOT NULL` and orders by `embedding <=> vector`. There is no path that uses `text_lemmatized` (GIN index — already exists in the `brain_fact` schema per the spec) for keyword/FTS recall.
**Mode A gap:** Workspaces in Mode A can never retrieve facts via `searchBrain`. The GIN index exists but is unused.
**Severity:** BLOCKING for Mode A.
**Fix locus:** Phase 1 (or Phase 2 if we ship Mode A only after extraction is moved) — `packages/mnemosyne/src/recall/search.ts` adds a branch: if `detectMode === 'A'`, run a `ts_rank_cd(text_lemmatized, plainto_tsquery('simple', $query))` ORDER BY query instead of the vector-distance query. Score weights collapse to `0.6 * fts + 0.2 * recency + 0.1 * frequency + 0.1 * pin_bonus` (semantic dropped, relevance kept).

##### M-A-003 · `createFact` (store.ts:55) — auto-embeds unconditionally

**Current behavior:** Lines 57-65: `if (!embedding) { const [vec] = await embedBrain(...); embedding = vec ?? null; }`. The fallback `null` only takes effect if `embedBrain` returns an empty array, but the call itself will throw in Mode A (see M-A-001 root cause).
**Mode A gap:** Creating a fact in Mode A always fails because the embedding call throws.
**Severity:** BLOCKING for Mode A (transitive on M-A-001).
**Fix locus:** Phase 1, `packages/mnemosyne/src/primitives/fact.ts` — when `embedMnemo` returns `[]` (Mode A signal), persist with `embedding: null` and proceed. The schema already allows `embedding` to be nullable (verified in migration 0017).

##### M-A-004 · `updateFact` (store.ts:161) — auto-re-embeds on statement change

**Current behavior:** Lines 162-170: when `patch.statement` is set, re-embeds. Same failure mode as M-A-003.
**Mode A gap:** Updating a fact's statement in Mode A always fails.
**Severity:** BLOCKING for Mode A.
**Fix locus:** Phase 1, in the Mnemosyne `updateFact` port — same guard as M-A-003 (skip re-embed in Mode A; set `embedding: null`).

##### M-A-005 · `extractFacts` (extract.ts:67) + `runBrainExtractJob` (extract-job.ts:27)

**Current behavior:** No mode awareness. `runBrainExtractJob` always runs `extractFacts` which always calls `llmCall`.
**Mode A gap:** Job will throw on every poll because Mode A workspaces have no LLM provider configured.
**Severity:** BLOCKING for Mode A (operationally, would spam pg-boss retry queue).
**Fix locus:** Phase 1, in `enqueueBrainExtract` / `enqueueMnemoExtract` — `if (detectMode(workspaceId) !== 'C') { /* mark skipped + return */ }`. Tracking row gets `state='skipped'`, `skip_reason='mode_a_or_b'`. No pg-boss enqueue.

#### Mode B (embeddings only, no LLM) gaps

| Function       | Gap                                                                                  |
| -------------- | ------------------------------------------------------------------------------------ |
| `extractFacts` | Same as Mode A — must be skipped.                                                    |
| `searchBrain`  | OK (vector path works; no FTS fallback needed since embeddings are present).         |
| `createFact`   | OK once F-002/F-003 fixed (caller must pass provider/model from workspace settings). |

Mode B is **not a blocking gap** — fixing F-001/F-002/F-003 + M-A-005 (skip extraction) is sufficient.

#### Summary

- **5 Mode A BLOCKING gaps** (M-A-001 through M-A-005).
- **0 Mode B BLOCKING gaps** (transitively fixed by F-001 to F-003 and M-A-005).
- All gaps are addressable in Phase 1 (Migration) — no changes to existing brain code needed in Phase 0.

## Fix plan

(populated in Task 0.5)
