// packages/mnemosyne/src/index.ts
//
// Public API barrel for @orchester/mnemosyne.
// Multi-tenant memory architecture for AI agents.
// See docs/specs/2026-05-24-mnemosyne-design.md

export const MNEMOSYNE_VERSION = "0.1.0";

// Memory Protocol v1 — frozen system-prompt artifact injected by the host
// agent runtime so every agent knows how/when to use mnemosyne_* tools.
// Bumping MEMORY_PROTOCOL_VERSION invalidates extractions tagged with the
// prior version (see §13 of the design spec).
export { MEMORY_PROTOCOL_V1, MEMORY_PROTOCOL_VERSION } from "./protocol/v1";

// PII detection / redaction — regex-only layer (§5.4 of the design spec).
// NER + LLM layers are optional add-ons (Phase 5.2 / 5.3).
export { detectPII, type PIIDetectionResult } from "./pii/detect";
export { redactPII } from "./pii/redact";
export { PII_PATTERNS, PII_SEVERITY, type PIICategory } from "./pii/patterns";

// §39 Operational Modes — Graceful Degradation. Pure-code resolver from a
// capability snapshot (has LLM / has embed) to one of A / B / C.
export {
  resolveModeFromCapabilities,
  type MnemoMode,
  type CapabilitySnapshot,
} from "./modes/detect";

// §5 Hybrid retrieval — recall search over `mnemo_fact`. Mode A falls
// back to FTS via the `text_lemmatized` GIN index; Mode B/C uses
// pgvector semantic + the blended hybrid score.
export {
  searchMnemo,
  type SearchMnemoInput,
  type RecallHit,
  type RecallReasons,
} from "./recall/search";
