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

(populated in Task 0.3)

### Mode A compatibility gaps

(populated in Task 0.4)

## Fix plan

(populated in Task 0.5)
