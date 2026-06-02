import { POISONING_PATTERNS, POISONING_SEVERITY, type PoisoningCategory } from "./patterns";

/** AGT parity: maxContextSizeBytes 100_000. */
export const MAX_FACT_BYTES = 100_000;
/** Severity threshold below which a finding is log-only, not blocking. */
export const MIN_POISON_SEVERITY = 0.6;
/** Shannon entropy >= this flags `high_entropy_blob`. Real prose
 *  hovers at 4.0-4.5 bits/char; base64/encrypted blobs sit at 5.8+. */
export const ENTROPY_THRESHOLD = 5.4;
/** Skip the entropy test on short strings — UUIDs would trip it. */
export const ENTROPY_MIN_LENGTH = 64;

export interface PoisoningFinding {
  category: PoisoningCategory;
  severity: number;
  evidence: string;
}

export interface PoisoningScanResult {
  ok: boolean;
  findings: PoisoningFinding[];
  bytes: number;
}

export function scanForPoisoning(text: string): PoisoningScanResult {
  const bytes = Buffer.byteLength(text, "utf8");
  const findings: PoisoningFinding[] = [];

  if (bytes > MAX_FACT_BYTES) {
    findings.push({
      category: "oversize_payload",
      severity: POISONING_SEVERITY.oversize_payload,
      evidence: `bytes=${bytes} (>${MAX_FACT_BYTES})`,
    });
    return { ok: false, findings, bytes };
  }

  for (const [cat, re] of Object.entries(POISONING_PATTERNS)) {
    const m = re.exec(text);
    if (m) {
      const category = cat as PoisoningCategory;
      findings.push({
        category,
        severity: POISONING_SEVERITY[category],
        evidence: excerpt(m[0]),
      });
    }
  }

  if (text.length >= ENTROPY_MIN_LENGTH) {
    const h = shannonEntropy(text);
    if (h >= ENTROPY_THRESHOLD) {
      findings.push({
        category: "high_entropy_blob",
        severity: POISONING_SEVERITY.high_entropy_blob,
        evidence: `entropy=${h.toFixed(2)} (>${ENTROPY_THRESHOLD})`,
      });
    }
  }

  const ok = !findings.some((f) => f.severity >= MIN_POISON_SEVERITY);
  return { ok, findings, bytes };
}

function excerpt(s: string): string {
  return s.length <= 60 ? s : s.slice(0, 59) + "…";
}

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  const n = s.length;
  let h = 0;
  for (const count of freq.values()) {
    const p = count / n;
    h -= p * Math.log2(p);
  }
  return h;
}
