// apps/web/tests/unit/handle-error.spec.ts
//
// PERF-13: handleError must log server-side (redacted) and return a generic body
// — never the raw e.message — with the given status.
import { describe, it, expect, vi } from "vitest";

const safeLogError = vi.fn();
vi.mock("@/lib/safe-log", () => ({ safeLogError }));

describe("PERF-13 — handleError", () => {
  it("returns a generic message + status and does not leak e.message", async () => {
    const { handleError } = await import("@/lib/api-response");
    const res = handleError(
      "[test]",
      new Error("Postgres connection string sk-ant-secret leaked"),
      500
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toMatch(/sk-ant-secret/);
    expect(safeLogError).toHaveBeenCalledWith("[test]", expect.any(Error));
  });

  it("defaults to status 500", async () => {
    const { handleError } = await import("@/lib/api-response");
    const res = handleError("[test]", new Error("boom"));
    expect(res.status).toBe(500);
  });
});
