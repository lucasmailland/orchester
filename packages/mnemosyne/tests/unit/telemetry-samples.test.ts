// packages/mnemosyne/tests/unit/telemetry-samples.test.ts
//
// Coverage for the Inspector UI v2 sample helpers in telemetry.ts.

import { describe, it, expect } from "vitest";
import { previewStatement, RECALL_SAMPLE_PREVIEW_MAX } from "../../src/recall/telemetry";

describe("previewStatement (#Inspector UI v2)", () => {
  it("returns the statement unchanged when within the cap", () => {
    expect(previewStatement("short text")).toBe("short text");
  });

  it("returns the statement unchanged at exactly the cap", () => {
    const at = "x".repeat(RECALL_SAMPLE_PREVIEW_MAX);
    expect(previewStatement(at)).toBe(at);
    expect(previewStatement(at)).toHaveLength(RECALL_SAMPLE_PREVIEW_MAX);
  });

  it("truncates and appends ellipsis when over the cap", () => {
    const over = "y".repeat(RECALL_SAMPLE_PREVIEW_MAX + 50);
    const out = previewStatement(over);
    expect(out.length).toBe(RECALL_SAMPLE_PREVIEW_MAX);
    expect(out.endsWith("…")).toBe(true);
  });

  it("uses a single character for the ellipsis (no triple-dot expansion)", () => {
    const over = "z".repeat(RECALL_SAMPLE_PREVIEW_MAX + 1);
    const out = previewStatement(over);
    // The body before the ellipsis is RECALL_SAMPLE_PREVIEW_MAX - 1
    expect(out.length).toBe(RECALL_SAMPLE_PREVIEW_MAX);
    expect(out.slice(-1)).toBe("…");
    expect(out.slice(0, -1)).toBe("z".repeat(RECALL_SAMPLE_PREVIEW_MAX - 1));
  });

  it("never exceeds the cap regardless of input length", () => {
    for (const len of [1, 100, 199, 200, 201, 500, 5000]) {
      const out = previewStatement("a".repeat(len));
      expect(out.length).toBeLessThanOrEqual(RECALL_SAMPLE_PREVIEW_MAX);
    }
  });
});
