// packages/mnemosyne/src/pii/detect.ts
//
// PII detection regex layer. NER + LLM layers are optional add-ons
// (Phase 5.2 / Phase 5.3 in spec).

import { PII_PATTERNS, PII_SEVERITY, type PIICategory } from "./patterns";

export interface PIIDetectionResult {
  detected: boolean;
  categories: PIICategory[];
  risk_score: number; // 0..1
  matches: Array<{ category: PIICategory; match: string }>;
}

export function detectPII(text: string): PIIDetectionResult {
  const matches: PIIDetectionResult["matches"] = [];
  const categories = new Set<PIICategory>();
  let maxScore = 0;
  for (const [cat, re] of Object.entries(PII_PATTERNS) as Array<[PIICategory, RegExp]>) {
    const m = text.match(re);
    if (m) {
      matches.push({ category: cat, match: m[0] });
      categories.add(cat);
      maxScore = Math.max(maxScore, PII_SEVERITY[cat]);
    }
  }
  return {
    detected: matches.length > 0,
    categories: Array.from(categories),
    risk_score: maxScore,
    matches,
  };
}
