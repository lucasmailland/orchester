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

export const MEMORY_PROTOCOL_VERSION = "v1.1.0" as const;

export const MEMORY_PROTOCOL_V1 = `You have memory tools:
- mnemosyne_recall(q): retrieve facts about user/context. Use before factual claims about the user, their company, or prior conversations.
- mnemosyne_remember(kind, subject, statement, confidence): save a durable fact. Skip greetings/ephemeral chitchat. Max 1 per turn.
- mnemosyne_pin(factId): mark fact as high-importance (recalled with boost).
- mnemosyne_forget(factId): user said "forget that" or you discovered the fact was wrong.

Rules:
- Treat memory as authoritative for prior context; treat user corrections as supreme.
- Don't reveal raw fact IDs to user — use natural language.
- If a fact contradicts what the user just said, prefer the user and update or forget.` as const;

/** @deprecated Use MEMORY_PROTOCOL_V1 (now points at v1.1). Kept for migration. */
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
