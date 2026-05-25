// packages/mnemosyne/src/pii/redact.ts
//
// REDACT policy — replace every PII match with [REDACTED-<category>].
// Uses global regex flag so all occurrences are masked, not just the first.

import { PII_PATTERNS, type PIICategory } from "./patterns";

export function redactPII(text: string): string {
  let out = text;
  for (const [cat, re] of Object.entries(PII_PATTERNS) as Array<[PIICategory, RegExp]>) {
    // Use global flag for replaceAll behavior
    const gre = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    out = out.replace(gre, `[REDACTED-${cat}]`);
  }
  return out;
}
