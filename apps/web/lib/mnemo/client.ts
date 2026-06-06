// apps/web/lib/mnemo/client.ts
//
// Singleton @mnemosyne/client-ts accessor for the server runtime.
//
// Phase 2 of the mnemosyne-service-extraction plan migrates each
// in-process call to `@mnemosyne/core` over to an HTTP call against the
// `@mnemosyne/server` instance pointed to by `MNEMO_URL`. This helper
// is the single entry point — every route, worker, and library that
// reaches the SDK MUST go through `getMnemoClient()` so we:
//
//   1. Construct the underlying `MnemosyneClient` exactly once per
//      process (the SDK keeps an internal fetch keep-alive agent that
//      we don't want to re-create per request).
//   2. Fail loudly at boot if the environment isn't configured, instead
//      of producing a half-wired client that 401s on every call.
//   3. Have one place to swap the implementation (e.g. for an
//      in-process mock during the migration, or for a different
//      transport later).
//
// Until every Phase 2 callsite has been migrated, this module is
// imported lazily by the routes that already use the SDK; the
// in-process `@mnemosyne/core` path stays the canonical runtime so
// nothing breaks if `MNEMO_URL` isn't set in a given environment.
import "server-only";
import { MnemosyneClient } from "@mnemosyne/client-ts";

/**
 * Whether the dual-mode helpers should call out over HTTP (service)
 * or run the in-process `@mnemosyne/core` library path (library).
 *
 * Centralised here so every helper under `apps/web/lib/mnemo/*.ts`
 * reads the SAME logic. When `MNEMO_URL` / `MNEMO_API_KEY` setup
 * changes (e.g. multi-region routing, fallback rules), there's
 * exactly one place to update.
 */
export type MnemoMode = "service" | "library";

/**
 * Read the active dual-mode at runtime. Service mode is selected
 * iff BOTH env vars are present and truthy. Anything else (missing
 * either var, both blank) falls through to library mode — by design,
 * so a partial deploy can't half-wire the SDK.
 */
export function getMnemoMode(): MnemoMode {
  return process.env["MNEMO_URL"] && process.env["MNEMO_API_KEY"] ? "service" : "library";
}

let _client: MnemosyneClient | undefined;

/**
 * Returns the shared MnemosyneClient instance, constructing it on
 * first call. Throws at boot if `MNEMO_URL` or `MNEMO_API_KEY` is
 * missing — Phase 2 migrations should only land in environments that
 * have the server configured.
 */
export function getMnemoClient(): MnemosyneClient {
  if (_client) return _client;

  const url = process.env["MNEMO_URL"];
  const apiKey = process.env["MNEMO_API_KEY"];

  if (!url || !apiKey) {
    throw new Error(
      "[mnemosyne/client] MNEMO_URL and MNEMO_API_KEY must be set to use the HTTP SDK. " +
        "Phase 1 brings up the service at vendor/mnemosyne/docker — see " +
        "docs/superpowers/plans/2026-06-05-mnemosyne-service-extraction.md."
    );
  }

  _client = new MnemosyneClient({ url, apiKey });
  return _client;
}

/**
 * Test-only override. Use in integration tests to inject a stub or a
 * client pointed at a local test server. Production code MUST NOT
 * call this.
 */
export function _setMnemoClientForTests(client: MnemosyneClient | undefined): void {
  _client = client;
}
