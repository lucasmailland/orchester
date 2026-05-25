// packages/mnemosyne/src/pii/patterns.ts
//
// Regex patterns for common PII categories. Conservative — prefer
// false negatives over false positives (downstream LLM layer can
// catch high-confidence cases).

export type PIICategory =
  | "email"
  | "phone"
  | "credit_card"
  | "ssn"
  | "api_key"
  | "ip_address"
  | "url_with_token";

export const PII_PATTERNS: Record<PIICategory, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  phone: /(?:\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/,
  credit_card: /\b(?:\d{4}[\s-]?){3}\d{4}\b/,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/,
  api_key: /\b(?:sk-|pk_|api[_-]?key[=:\s]+|Bearer\s+)[A-Za-z0-9_-]{20,}/,
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  url_with_token: /https?:\/\/[^\s]+[?&](?:token|access_token|api_key|key)=[^\s&]+/,
};

export const PII_SEVERITY: Record<PIICategory, number> = {
  api_key: 1.0,
  credit_card: 0.95,
  ssn: 0.95,
  email: 0.5,
  phone: 0.55,
  ip_address: 0.3,
  url_with_token: 0.85,
};
