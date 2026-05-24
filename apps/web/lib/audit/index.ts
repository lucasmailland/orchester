// apps/web/lib/audit/index.ts
//
// Barrel for the audit log module. Re-exports the public surface so
// callers can `import { appendAudit, verifyChain } from "@/lib/audit"`
// without reaching into the individual files.
export * from "./types";
export * from "./chain";
export * from "./log";
export * from "./verify";
