# ADR-015 — Brain Core extraction: cheap model per conversation batch

Date: 2026-05-24 · Status: Superseded by ADR-020 (Mnemosyne) on 2026-05-24, fully retired on 2026-06-05 (Phase 3 cut-over)

## Context

Fact extraction is on every inbound conversation turn. Cost grows linearly
with traffic. Three strategies considered:

1. Strong model (Sonnet/4o), per-message, inline
2. Cheap model (Haiku/4o-mini), per-batch, async
3. Strong model, per-session-close, async

## Decision

Strategy 2: cheap model, per conversation batch, async via pg-boss. Job
fires after the assistant turn commits with `singletonKey` on
`brain.extract:{conversationId}`, collapsing concurrent triggers so we
re-process the same conversation at most once per pg-boss tick.

Max 20 messages per batch. Default model: `claude-haiku-4-5`. Workspace
spend cap (`assertWithinSpend`) applies, so a runaway agent doesn't
silently rack up extraction cost.

## Consequences

**Positive:** ~$0.0001 per turn vs ~$0.005 with Sonnet. Async means the
agent reply is never blocked. Singleton keeps the queue bounded.

**Negative:** facts arrive seconds after the turn, not synchronously —
the very next turn may miss them. Acceptable: durable facts are about
patterns, not real-time state.

**Revisit when:** customer asks for inline fact-grounded responses
(then we add a sync `extractFactsNow` path for one-off use).
