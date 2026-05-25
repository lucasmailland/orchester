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
export {
  MEMORY_PROTOCOL_V1,
  MEMORY_PROTOCOL_VERSION,
  MEMORY_PROTOCOL_V1_LEGACY,
} from "./protocol/v1";

// PII detection / redaction — regex-only layer (§5.4 of the design spec).
// NER + LLM layers are optional add-ons (Phase 5.2 / 5.3).
export { detectPII, type PIIDetectionResult } from "./pii/detect";
export { redactPII, redactPIIWithCategories, type RedactPIIResult } from "./pii/redact";
export { PII_PATTERNS, PII_SEVERITY, type PIICategory } from "./pii/patterns";

// Candidate-on-write for facts (v1.1 §7). Surfaces potential
// contradictions when a new fact is saved so the caller can run LLM
// judgment (Mode C) or queue for human review (Mode A/B).
export {
  saveFactWithCandidates,
  type FactCandidate,
  type SaveFactWithCandidatesInput,
  type SaveFactWithCandidatesOutput,
} from "./conflict/fact-candidate";

// §39 Operational Modes — Graceful Degradation. Pure-code resolver from a
// capability snapshot (has LLM / has embed) to one of A / B / C, plus a
// health-aware resolver that combines configured capabilities with live
// provider health for graceful degradation under outage (v1.1).
export {
  resolveModeFromCapabilities,
  resolveConfiguredMode,
  resolveActiveMode,
  type MnemoMode,
  type CapabilitySnapshot,
  type ActiveModeResult,
  type ResolveActiveModeInput,
  type PartialAvailability,
  type DegradationReason,
} from "./modes/detect";

// Provider health tracker (in-memory rolling-window). Feeds
// `resolveActiveMode`. See packages/mnemosyne/src/modes/health.ts for
// the window policy + HMR-safe stash details.
export {
  recordProviderResult,
  getProviderHealth,
  resetProviderHealth,
  type ProviderKind,
  type ProviderHealth,
  type ProviderHealthSample,
} from "./modes/health";

// §5 Hybrid retrieval — recall search over `mnemo_fact`. Mode A falls
// back to FTS via the `text_lemmatized` GIN index; Mode B/C uses
// pgvector semantic + the blended hybrid score.
export {
  searchMnemo,
  type SearchMnemoInput,
  type RecallHit,
  type RecallReasons,
} from "./recall/search";
