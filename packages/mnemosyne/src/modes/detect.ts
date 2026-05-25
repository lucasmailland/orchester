// packages/mnemosyne/src/modes/detect.ts
//
// §39 Operational Modes — Graceful Degradation.
// Pure-code helper: given capability flags, return active mode.
//
//   Mode A — manual only (no providers, or LLM without embed)
//   Mode B — semantic recall (embed only)
//   Mode C — full auto-extraction + recall (LLM + embed)

export type MnemoMode = "A" | "B" | "C";

export interface CapabilitySnapshot {
  hasLLM: boolean;
  hasEmbed: boolean;
}

export function resolveModeFromCapabilities(caps: CapabilitySnapshot): MnemoMode {
  if (caps.hasLLM && caps.hasEmbed) return "C";
  if (caps.hasEmbed) return "B";
  return "A";
}
