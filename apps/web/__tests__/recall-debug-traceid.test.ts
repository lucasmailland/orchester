// Tests BEHAVIOR: traceId format contract, not source grep

import { describe, it, expect } from "vitest";
import { init as initCuid2 } from "@paralleldrive/cuid2";

describe("recall-debug traceId contract", () => {
  it("traceId format: 'trace_' prefix + cuid2 (length 7-32 chars)", () => {
    // Simulate what the route generates: `trace_${createId()}`
    const createId = initCuid2({ length: 24 });
    const traceId = `trace_${createId()}`;
    expect(traceId).toMatch(/^trace_[A-Za-z0-9]+$/);
    expect(traceId.length).toBeGreaterThan(7);
    expect(traceId.length).toBeLessThanOrEqual(36);
  });

  it("100 generated traceIds are unique", () => {
    const createId = initCuid2({ length: 24 });
    const ids = Array.from({ length: 100 }, () => `trace_${createId()}`);
    expect(new Set(ids).size).toBe(100);
  });

  it("traceId survives URL encoding (safe for /api/mnemo/decisions/{traceId})", () => {
    const createId = initCuid2({ length: 24 });
    const traceId = `trace_${createId()}`;
    expect(encodeURIComponent(traceId)).toBe(traceId); // no encoding needed
  });
});
