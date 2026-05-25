// packages/mnemosyne/src/pii/redact.ts
//
// REDACT policy — replace every PII match with [REDACTED-<category>].
// Uses global regex flag so all occurrences are masked, not just the first.
//
// `redactPII` returns just the redacted string (back-compat).
// `redactPIIWithCategories` returns `{ redacted, categories }` so callers
// (e.g. createFact's PII wiring) can stash matched categories in metadata
// without re-running detection.

import { PII_PATTERNS, type PIICategory } from "./patterns";

export interface RedactPIIResult {
  redacted: string;
  categories: PIICategory[];
}

export function redactPIIWithCategories(text: string): RedactPIIResult {
  let out = text;
  const categories = new Set<PIICategory>();
  for (const [cat, re] of Object.entries(PII_PATTERNS) as Array<[PIICategory, RegExp]>) {
    // Use global flag for replaceAll behavior
    const gre = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let matched = false;
    out = out.replace(gre, () => {
      matched = true;
      return `[REDACTED-${cat}]`;
    });
    if (matched) categories.add(cat);
  }
  return { redacted: out, categories: Array.from(categories) };
}

export function redactPII(text: string): string {
  return redactPIIWithCategories(text).redacted;
}
