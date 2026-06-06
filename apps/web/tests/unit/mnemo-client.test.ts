// apps/web/tests/unit/mnemo-client.test.ts
//
// Phase 2 scaffolding smoke. Verifies the @mnemosyne/client-ts SDK is
// reachable from the host bundle and that `getMnemoClient()` enforces
// its env-var contract (boot-time fail-loud, never silent).
//
// Once Phase 2 routes start landing, each one gets its own test that
// mocks the HTTP transport via vi.mock("@mnemosyne/client-ts"). This
// file deliberately exercises the REAL SDK import path so a future
// breakage in the submodule build (or in the file: dep wiring) is
// caught here before downstream tests get confused by transitive
// import errors.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("@mnemosyne/client-ts SDK is importable", () => {
  it("exports MnemosyneClient as a constructable class", async () => {
    const sdk = await import("@mnemosyne/client-ts");
    expect(sdk).toHaveProperty("MnemosyneClient");
    expect(typeof sdk.MnemosyneClient).toBe("function");
    // Construct with the canonical minimal options. The SDK does NOT
    // make a network call at construction time — that's a documented
    // guarantee we rely on for Phase 2's lazy wiring.
    const instance = new sdk.MnemosyneClient({
      url: "http://localhost:3939",
      apiKey: "mns_live_test_dummy",
    });
    expect(instance).toBeInstanceOf(sdk.MnemosyneClient);
  });

  it("exposes the error types the route handlers will catch on", async () => {
    const sdk = await import("@mnemosyne/client-ts");
    // These are documented in vendor/mnemosyne/packages/client-ts/src/index.ts
    // as part of the stable public surface; missing means the SDK was
    // built from an unexpected source tree.
    expect(sdk).toHaveProperty("MnemosyneError");
    expect(sdk).toHaveProperty("MnemosyneAPIError");
    expect(sdk).toHaveProperty("MnemosyneNetworkError");
    expect(sdk).toHaveProperty("MnemosyneTimeoutError");
  });
});

describe("getMnemoClient()", () => {
  // Snapshot the env so individual tests can mutate it without
  // leaking into siblings.
  const ORIGINAL = {
    url: process.env["MNEMO_URL"],
    apiKey: process.env["MNEMO_API_KEY"],
  };

  beforeEach(() => {
    // Each test starts from a clean module cache so the singleton
    // initialises fresh against the env we set below.
    vi.resetModules();
    delete process.env["MNEMO_URL"];
    delete process.env["MNEMO_API_KEY"];
  });

  afterEach(() => {
    process.env["MNEMO_URL"] = ORIGINAL.url ?? "";
    process.env["MNEMO_API_KEY"] = ORIGINAL.apiKey ?? "";
    if (!ORIGINAL.url) delete process.env["MNEMO_URL"];
    if (!ORIGINAL.apiKey) delete process.env["MNEMO_API_KEY"];
  });

  it("throws fail-loud when MNEMO_URL is missing", async () => {
    process.env["MNEMO_API_KEY"] = "mns_live_test_dummy";
    const mod = await import("@/lib/mnemo/client");
    expect(() => mod.getMnemoClient()).toThrow(/MNEMO_URL and MNEMO_API_KEY are required/);
  });

  it("throws fail-loud when MNEMO_API_KEY is missing", async () => {
    process.env["MNEMO_URL"] = "http://localhost:3939";
    const mod = await import("@/lib/mnemo/client");
    expect(() => mod.getMnemoClient()).toThrow(/MNEMO_URL and MNEMO_API_KEY are required/);
  });

  it("constructs and returns the same singleton across calls", async () => {
    process.env["MNEMO_URL"] = "http://localhost:3939";
    process.env["MNEMO_API_KEY"] = "mns_live_test_dummy";
    const mod = await import("@/lib/mnemo/client");
    const a = mod.getMnemoClient();
    const b = mod.getMnemoClient();
    expect(a).toBe(b);
  });
});
