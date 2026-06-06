// apps/web/lib/mnemo/client.ts
//
// Singleton @mnemosyne/client-ts accessor for the server runtime.
//
// Post Phase 3/4: orchester talks to mnemosyne EXCLUSIVELY over HTTP.
// There is no in-process library fallback. Every route, worker, and
// library that reaches the SDK MUST go through `getMnemoClient()` so we:
//
//   1. Construct the underlying `MnemosyneClient` exactly once per
//      process (the SDK keeps an internal fetch keep-alive agent that
//      we don't want to re-create per request).
//   2. Fail loudly at boot if the environment isn't configured, instead
//      of producing a half-wired client that 401s on every call.
//   3. Have one place to swap the implementation (e.g. for an
//      in-process mock during the migration, or for a different
//      transport later).
import "server-only";
import { MnemosyneClient } from "@mnemosyne/client-ts";

/**
 * Observability label kept as a singleton "service" so the
 * `X-Mnemo-Mode` response header keeps its operational signal. The
 * legacy `library` value was retired when @mnemosyne/core was
 * removed from orchester's runtime — every request is now HTTP.
 */
export type MnemoMode = "service";

/**
 * Always `"service"` now. Kept as a function (not a constant) so
 * existing call sites stay unchanged.
 */
export function getMnemoMode(): MnemoMode {
  return "service";
}

let _client: MnemosyneClient | undefined;

/**
 * Returns the shared MnemosyneClient instance, constructing it on
 * first call. Throws at boot if `MNEMO_URL` or `MNEMO_API_KEY` is
 * missing — orchester REQUIRES a configured Mnemosyne service to run.
 */
export function getMnemoClient(): MnemosyneClient {
  if (_client) return _client;

  const url = process.env["MNEMO_URL"];
  const apiKey = process.env["MNEMO_API_KEY"];

  if (!url || !apiKey) {
    throw new Error(
      "[mnemosyne/client] MNEMO_URL and MNEMO_API_KEY are required. " +
        "Orchester no longer ships an in-process memory engine — point it at " +
        "a running @mnemosyne/server (self-host with `docker compose up -d` " +
        "in vendor/mnemosyne/docker, or pull a release image from " +
        "ghcr.io/lucasmailland/mnemosyne-server)."
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
