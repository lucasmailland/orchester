export type QualityLabel = "Poor" | "Good" | "Excellent";

export interface QualityResult {
  score: number;
  label: QualityLabel;
  tokens: number;
  chars: number;
}

const ACTION_VERB_RE = /(you are|your job|you must|you should|always|never)/i;
const EXAMPLE_RE = /(for example|e\.g\.|example:|p\.\s?ej\.|por ejemplo)/i;

export function promptQuality(text: string): QualityResult {
  const trimmed = (text || "").trim();
  let score = 0;
  if (trimmed.length > 200) score += 30;
  if (ACTION_VERB_RE.test(trimmed)) score += 20;
  if (trimmed.includes("{{")) score += 20;
  if (trimmed.length > 500) score += 15;
  if (EXAMPLE_RE.test(trimmed)) score += 15;
  score = Math.min(100, score);
  const label: QualityLabel = score < 40 ? "Poor" : score <= 70 ? "Good" : "Excellent";
  return {
    score,
    label,
    chars: trimmed.length,
    tokens: Math.ceil(trimmed.length / 4),
  };
}
