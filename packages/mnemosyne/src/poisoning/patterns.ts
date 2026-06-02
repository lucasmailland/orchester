// Context-poisoning pattern catalogue for memory ingest. Borrowed from
// microsoft/agent-governance-toolkit's ContextPoisoningDetector. PURE
// MODULE — no host imports.

export type PoisoningCategory =
  | "delimiter_injection"
  | "role_escape"
  | "instruction_override"
  | "system_prompt_exfil"
  | "high_entropy_blob"
  | "oversize_payload";

export const POISONING_PATTERNS: Record<
  Exclude<PoisoningCategory, "high_entropy_blob" | "oversize_payload">,
  RegExp
> = {
  delimiter_injection:
    /(<\|(?:im_(?:start|end)|system|user|assistant)\|>|\[\/?INST\]|<<\/?SYS>>|```\s*(?:system|assistant|user)\b)/i,
  role_escape: /\b(?:act\s+as|pretend\s+to\s+be|you\s+are\s+now|simulate\s+(?:being|the))\b/i,
  instruction_override:
    /\b(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|above|the\s+(?:above|earlier))/i,
  system_prompt_exfil:
    /\b(?:reveal|print|dump|expose|show\s+me)\s+(?:(?:your|the)\s+)?(?:system|initial|hidden|original|secret)\s+(?:prompt|instructions?|context|message)\b/i,
};

export const POISONING_SEVERITY: Record<PoisoningCategory, number> = {
  delimiter_injection: 0.95,
  role_escape: 0.7,
  instruction_override: 0.85,
  system_prompt_exfil: 0.9,
  high_entropy_blob: 0.6,
  oversize_payload: 0.5,
};
