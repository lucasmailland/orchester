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

(populated in Task 0.4)

## Fix plan

(populated in Task 0.5)
