# ADR-014 — Brain Core fact format: structured hybrid

Date: 2026-05-24 · Status: Accepted

## Context

Brain Core stores durable facts extracted from conversations. The
storage format must let agents reason about facts ("user prefers async
standups"), let operators audit them, let GDPR export them, and stay
embeddable for semantic recall.

Three obvious shapes existed: pure free-text strings, pure RDF triples
(`subject predicate object`), or a hybrid.

## Decision

Store every fact as `{kind, subject, statement, confidence}` where:

- `kind` is a small enum (preference / trait / event / relationship / skill / concern / other) — gives operators a coarse filter and lets the recall scorer weight differently per kind in future
- `subject` is a short free-text label ("user", "@daisy", "company") — operators group by it; recall filters use it
- `statement` is the durable fact in one sentence, free-text — what gets embedded and read by the agent
- `confidence` is a 0-1 score from the extraction LLM

## Consequences

**Positive:** structured enough to dedup (`md5(statement)` partial unique index
on `(scope, scope_ref, subject)`) and filter; free-text enough for the LLM to
extract without rigid schema; embedding-friendly.

**Negative:** subject inconsistency ("user" vs "the user" vs "@john") makes
grouping noisier than triples. Compaction's similarity check covers most cases.

**Revisit when:** entity resolution arrives in Employee 360 (sub-spec 4) — at
that point `subject` becomes a foreign-key to a canonical entity.
