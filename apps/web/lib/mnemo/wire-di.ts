// apps/web/lib/mnemo/wire-di.ts
//
// Inert stub kept only so callers that historically called
// `wireMnemoDb()` at boot don't break on import. After Phase 3,
// @mnemosyne/core is no longer in orchester's runtime — there is no
// DI registry to populate. The mnemosyne server runs in its own
// process with its own DB pool.

/**
 * No-op. Kept for source compatibility with the legacy boot path that
 * called `wireMnemoDb()` from instrumentation / worker entrypoints.
 * Returns `false` so the "first-registration" branch in callers stays
 * inactive.
 */
export async function wireMnemoDb(): Promise<boolean> {
  return false;
}
