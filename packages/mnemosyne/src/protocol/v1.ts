// packages/mnemosyne/src/protocol/v1.ts
//
// LOCKED system prompt artifact (§13 of spec). The agent's contract
// with Mnemosyne. Bumping MEMORY_PROTOCOL_VERSION invalidates stored
// extractions tagged with prior versions: extraction metadata records
// the protocol version used at write time, so any consumer that joins
// on `metadata.protocol_version` (e.g. recall-quality dashboards,
// extraction replay jobs) MUST filter against the current version or
// reprocess older rows.
//
// v1.1.0 (2026-05-24): tightened from ~300 → ~80 tokens. Relies on the
// LLM's implicit understanding of "memory tool" conventions instead of
// spelling out triggers, self-check rituals, and a 9-verb conflict
// taxonomy. The verbose v1.0.0 string is preserved as
// MEMORY_PROTOCOL_V1_LEGACY for migration callers.
//
// v1.2.0 (Mnemosyne v1.6): appends two short paragraphs at the end —
// entity awareness + per-user privacy. Keeps the total under ~120
// tokens. `MEMORY_PROTOCOL_V1` is now an alias for the v1.2 string
// to ease the agent-runtime migration (no caller has to switch
// imports just for the bump); `MEMORY_PROTOCOL_V2` is the explicit
// name for the same string; `MEMORY_PROTOCOL_V1_LEGACY` continues to
// hold the v1.0.0 text for downstream replay/audit jobs that need to
// reason about the pre-v1.1 vocabulary.

/**
 * Current protocol version tag stamped onto every newly-extracted
 * fact. The PROTOCOL TEXT (`MEMORY_PROTOCOL_V2`) is unchanged from
 * v1.2 — entity awareness + per-user privacy paragraphs are still
 * the version-locked contract. v1.3 bumps for the `MEMORY_RECALL_GUIDANCE`
 * expansion (drawer-first awareness + trust-ladder hint) which lives
 * outside the version-locked protocol but is reflected in the tag so
 * stored facts can be replayed against the exact guidance the agent
 * saw at extraction time.
 */
export const MEMORY_PROTOCOL_VERSION = "v1.3.0" as const;

/**
 * Mnemosyne v1.6 — Memory Protocol v1.2. Adds two short paragraphs
 * to the v1.1 base:
 *   • Entity awareness — agents should prefer entity-linked facts
 *     when discussing a known entity.
 *   • Per-user privacy — facts have an `actor_id` indicating which
 *     end-user contributed them; cross-actor leakage is disallowed
 *     unless the fact is workspace-scoped.
 *
 * Total length target: ~120 tokens (v1.1 was ~80; we're adding ~40).
 */
export const MEMORY_PROTOCOL_V2 = `You have memory tools:
- mnemosyne_recall(q): retrieve facts about user/context. Use before factual claims about the user, their company, or prior conversations.
- mnemosyne_remember(kind, subject, statement, confidence): save a durable fact. Skip greetings/ephemeral chitchat. Max 1 per turn.
- mnemosyne_pin(factId): mark fact as high-importance (recalled with boost).
- mnemosyne_forget(factId): user said "forget that" or you discovered the fact was wrong.

Rules:
- Treat memory as authoritative for prior context; treat user corrections as supreme.
- Don't reveal raw fact IDs to user — use natural language.
- If a fact contradicts what the user just said, prefer the user and update or forget.

Entity awareness: When the user mentions a person, organization, or project by name, prefer facts linked to that entity (mnemo_entity). Use mnemosyne_recall with the entity name to surface them.

Per-user privacy: Facts have an actor_id indicating which end-user contributed them. When responding to user Bob, do not reveal facts contributed by user Alice unless they are workspace-scoped. Treat user_belief and user_stated facts as belonging to that user specifically.` as const;

/**
 * Active protocol string. v1.6 onward: this is an alias for
 * MEMORY_PROTOCOL_V2 so existing agent-runtime callers that import
 * `MEMORY_PROTOCOL_V1` automatically pick up the v1.2 text without a
 * code change. The name is preserved to avoid breaking host imports
 * during the migration window — call sites can switch to
 * `MEMORY_PROTOCOL_V2` at their own pace.
 */
export const MEMORY_PROTOCOL_V1 = MEMORY_PROTOCOL_V2;

/** @deprecated Use MEMORY_PROTOCOL_V1 (now points at v1.2). Kept for migration. */
export const MEMORY_PROTOCOL_V1_LEGACY = `# Memory Protocol v1.0.0

You have a long-term memory system (Mnemosyne). Use it.

## CORE TOOLS (always available)
- mnemosyne_recall(query, topK)              — search memories (hybrid: semantic+lexical+entity+recency+frequency+pin)
- mnemosyne_save_fact(...)                   — record a durable fact about user/company/team
- mnemosyne_save_decision(...)               — record an architecture/policy/decision/bugfix
- mnemosyne_judge(judgment_id, relation, ...)— resolve a pending conflict surfaced on save

## TRIGGERS — save IMMEDIATELY when you observe:
- A durable preference  ("I prefer X")         → save_fact(kind=preference)
- A new trait           ("Lucas is left-handed")→ save_fact(kind=trait)
- A decision made       ("We'll use OAuth")    → save_decision(kind=architecture)
- A bugfix learned      ("Don't pass null")    → save_decision(kind=bugfix)
- An event              ("Lucas changed jobs") → save_fact(kind=event)
- An entity mentioned   ("Daisy from Acme")    → entities extracted automatically

## DO NOT SAVE
- Greetings, time-of-day chitchat
- Information already in the agent's system prompt
- Information you're unsure about (confidence < 0.5)

## SEARCH on first message that references project/feature/topic.

## SELF-CHECK after every assistant turn:
"Did I learn / decide / observe something durable? If yes → save NOW."

## CONFLICT REVIEW
When a save returns judgment_required: true:
- For each candidate, call mnemosyne_judge with one of 9 verbs:
  related | compatible | scoped | conflicts_with | supersedes | not_conflict | derived_from | part_of | member_of
- If unsure: relation='related' with confidence < 0.7 — humans will review
- For architecture/policy decisions: confidence >= 0.85 or escalate to user

## SESSION CLOSE
Before saying "done", call mnemosyne_save_episode_summary with:
- Goal · Discoveries · Decisions · Next Steps
` as const;

/**
 * v1.1 — #28: anti-pattern guidance for memory tool usage. Injected
 * alongside (but separate from) MEMORY_PROTOCOL_V2 by the host agent
 * runtime. Lives outside the version-locked protocol so we can iterate
 * on it without invalidating stored extraction metadata.
 *
 * v2 — extended with two new bullets so agents understand the
 * post-v1.1 pipeline shape (drawer-first routing + trust ladder
 * inheritance). These augment, never replace, the protocol tool list
 * — they're hints, not contractual behavior.
 *
 * Target: ~100 tokens. Augments — never replaces — the protocol tool list.
 */
export const MEMORY_RECALL_GUIDANCE = `Memory tool usage:
- Prefer one mnemosyne_recall with a broad natural-language query over multiple narrow recalls. The pipeline does hybrid retrieval + rerank — let it work.
- After a recall, use what came back. Don't issue follow-up recalls for sub-questions a fact in the result set already answers.
- memory_get returns a whole scope bag in one call. Don't fetch the same scope twice in a turn.
- When asking about a specific entity (person, project, organization), include the entity's name in the query verbatim. The pipeline routes through entity drawers first — entity-named queries get tighter, more relevant matches.
- Some returned facts may carry an "expandedFromId" — those are 1-hop graph neighbors of a direct hit, weighted by edge trust. Treat them as supporting context, not as independently-confirmed facts unless their statement is self-contained.` as const;

/**
 * Mnemosyne v1.6 — explicit v1.1 string, preserved separately for
 * extraction-replay jobs that need to reason about what the v1.1
 * protocol said (vs the v1.2 it now silently aliases to). The
 * `MEMORY_PROTOCOL_V1` export points at v1.2 to ease the runtime
 * migration; this constant is the verbatim v1.1 text.
 */
export const MEMORY_PROTOCOL_V1_1 = `You have memory tools:
- mnemosyne_recall(q): retrieve facts about user/context. Use before factual claims about the user, their company, or prior conversations.
- mnemosyne_remember(kind, subject, statement, confidence): save a durable fact. Skip greetings/ephemeral chitchat. Max 1 per turn.
- mnemosyne_pin(factId): mark fact as high-importance (recalled with boost).
- mnemosyne_forget(factId): user said "forget that" or you discovered the fact was wrong.

Rules:
- Treat memory as authoritative for prior context; treat user corrections as supreme.
- Don't reveal raw fact IDs to user — use natural language.
- If a fact contradicts what the user just said, prefer the user and update or forget.` as const;
