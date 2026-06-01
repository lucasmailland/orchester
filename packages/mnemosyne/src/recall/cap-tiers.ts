// packages/mnemosyne/src/recall/cap-tiers.ts
//
// v1.1 #25 + v2 — Shared fact-count-bucket vocabulary.
//
// Both `tieredCap()` (v1.1 final cap) and `stage-caps.ts` (v2 per-stage
// caps) bucket workspaces into the same four tiers based on their
// total fact count. The bucket strings are also surfaced as the
// `fact_count_tier` tag on the `total` telemetry event so external
// dashboards can group by tier without parsing.
//
// Keep the string set frozen — host dashboards key on these values.

export type TieredFactCountBucket = "<1k" | "<10k" | "<100k" | ">=100k";
