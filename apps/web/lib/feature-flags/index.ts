// apps/web/lib/feature-flags/index.ts
//
// Barrel for the per-workspace feature flag module.
export * from "./check";
export * from "./admin";
export { invalidateFlag, invalidateAll } from "./cache";
