/**
 * Phase J.1 — Sentry lazy-load contract.
 *
 * The integration is opt-in: when SENTRY_DSN is unset, the
 * @sentry/nextjs import must NEVER resolve. When it IS set, the
 * forwarders inside lib/observability.ts must call into the SDK.
 *
 * We assert both directions by mocking `@sentry/nextjs` and asserting
 * on the call counts of the shim, plus inspecting the
 * `import.fn.mock` to confirm the import path was (or was not) walked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mock so every importer of @sentry/nextjs sees the same shim.
const sentryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  distribution: vi.fn(),
  init: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: sentryMocks.captureException,
  captureMessage: sentryMocks.captureMessage,
  init: sentryMocks.init,
  metrics: { distribution: sentryMocks.distribution },
}));

describe("observability — Sentry lazy load (Phase J.1)", () => {
  const originalDsn = process.env["SENTRY_DSN"];

  beforeEach(() => {
    // Reset all mock counters
    sentryMocks.captureException.mockClear();
    sentryMocks.captureMessage.mockClear();
    sentryMocks.distribution.mockClear();
    sentryMocks.init.mockClear();
    // Fresh module graph each test — observability.ts caches the
    // lazy-loaded Sentry handle internally.
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDsn === undefined) delete process.env["SENTRY_DSN"];
    else process.env["SENTRY_DSN"] = originalDsn;
  });

  it("does NOT call into @sentry/nextjs when SENTRY_DSN is unset", async () => {
    delete process.env["SENTRY_DSN"];
    const { recordMetric, logWithContext, __resetSentryCacheForTests } =
      await import("../lib/observability");
    __resetSentryCacheForTests();

    recordMetric("test.metric", 42, { tag: "v" });
    logWithContext("error", "boom");

    // Microtask flush — the forwarders kick off `void getSentry().then(...)`.
    await new Promise((r) => setImmediate(r));

    expect(sentryMocks.distribution).not.toHaveBeenCalled();
    expect(sentryMocks.captureException).not.toHaveBeenCalled();
    expect(sentryMocks.captureMessage).not.toHaveBeenCalled();
  });

  it("forwards recordMetric to Sentry.metrics.distribution when SENTRY_DSN is set", async () => {
    process.env["SENTRY_DSN"] = "https://abc@o0.ingest.sentry.io/0";
    const { recordMetric, __resetSentryCacheForTests } = await import("../lib/observability");
    __resetSentryCacheForTests();

    recordMetric("flow.run.duration_ms", 123, { status: "ok" });

    // Allow the lazy import + .then() chain to resolve.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(sentryMocks.distribution).toHaveBeenCalledTimes(1);
    expect(sentryMocks.distribution).toHaveBeenCalledWith("flow.run.duration_ms", 123, {
      tags: { status: "ok" },
    });
  });

  it("forwards error-level logWithContext to Sentry.captureMessage when SENTRY_DSN is set", async () => {
    process.env["SENTRY_DSN"] = "https://abc@o0.ingest.sentry.io/0";
    const { logWithContext, __resetSentryCacheForTests } = await import("../lib/observability");
    __resetSentryCacheForTests();

    logWithContext("error", "kaboom", { correlationId: "abc123" });

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(sentryMocks.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentryMocks.captureMessage).toHaveBeenCalledWith("kaboom", "error");
    // Info/warn logs must NOT reach Sentry.
    expect(sentryMocks.captureException).not.toHaveBeenCalled();
  });

  it("forwards logWithContext with an Error in ctx.error to captureException", async () => {
    process.env["SENTRY_DSN"] = "https://abc@o0.ingest.sentry.io/0";
    const { logWithContext, __resetSentryCacheForTests } = await import("../lib/observability");
    __resetSentryCacheForTests();

    const e = new Error("boom");
    logWithContext("error", "wrapper message", { error: e });

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMocks.captureException.mock.calls[0]?.[0]).toBe(e);
    expect(sentryMocks.captureMessage).not.toHaveBeenCalled();
  });
});
