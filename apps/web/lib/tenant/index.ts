/**
 * Barrel export for the tenant lib.
 *
 * Order: types are pure type-only and can be imported anywhere. Runtime
 * modules below depend on the DB client and may pull in `server-only`,
 * so the barrel itself is server-only.
 *
 * NOTE: re-exports grow as Phase A tasks land. The full surface after
 * Phase A is:
 *   - types       (A.12)
 *   - resolve     (A.13)
 *   - membership  (A.14)
 *   - context     (A.15)
 *   - guards      (A.15)
 *   - lifecycle   (later — Phase E)
 *   - session     (later — Phase D)
 */
export * from "./types";
export * from "./resolve";
export * from "./membership";
export * from "./context";
export * from "./guards";
