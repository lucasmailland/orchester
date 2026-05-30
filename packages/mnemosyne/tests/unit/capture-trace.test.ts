// packages/mnemosyne/tests/unit/capture-trace.test.ts
//
// Coverage for the `captureTrace` plumbing in search.ts. We don't spin
// up a real database; we exercise the pure sample-helpers via the
// re-exported telemetry surface and assert the shape that the
// Inspector UI endpoint depends on.
//
// The end-to-end flow (real recall → captured samples in the
// /api/mnemo/recall-debug response) is exercised by the broader
// search.test integration suite when the testcontainer fixture runs.

import { describe, it, expect } from "vitest";
import {
  previewStatement,
  RECALL_SAMPLE_PREVIEW_MAX,
  type RecallSample,
  type RecallMetricEvent,
} from "../../src/recall/telemetry";

// ── Sample shape contract (Inspector UI depends on this) ─────────────────────

describe("RecallSample contract", () => {
  it("preview never exceeds RECALL_SAMPLE_PREVIEW_MAX chars", () => {
    const long = "a".repeat(RECALL_SAMPLE_PREVIEW_MAX * 3);
    const sample: RecallSample = {
      factId: "f-1",
      score: 0.42,
      preview: previewStatement(long),
    };
    expect(sample.preview.length).toBeLessThanOrEqual(RECALL_SAMPLE_PREVIEW_MAX);
  });

  it("accepts an optional note for dropped-fact stages", () => {
    const sample: RecallSample = {
      factId: "f-2",
      score: 0.81,
      preview: "user prefers PostgreSQL",
      note: "cosine > 0.88 near-dup",
    };
    expect(sample.note).toBe("cosine > 0.88 near-dup");
  });

  it("can be omitted entirely (samples is optional on the event)", () => {
    const event: RecallMetricEvent = {
      stage: "first_stage",
      workspaceId: "ws-1",
      count: 10,
    };
    expect(event.samples).toBeUndefined();
  });
});

// ── Event shape contract (the /api/mnemo/recall-debug payload) ──────────────

describe("RecallMetricEvent + samples shape (Inspector UI)", () => {
  it("samples on first_stage carry per-hit data only (no drop note)", () => {
    const event: RecallMetricEvent = {
      stage: "first_stage",
      workspaceId: "ws-1",
      durationMs: 38,
      count: 3,
      topScore: 0.92,
      extra: { mode: "vector", pointer_hit: true },
      samples: [
        { factId: "f-1", score: 0.92, preview: "user prefers PostgreSQL" },
        { factId: "f-2", score: 0.84, preview: "user works in TypeScript" },
        { factId: "f-3", score: 0.71, preview: "user lives in Buenos Aires" },
      ],
    };
    expect(event.samples).toHaveLength(3);
    expect(event.samples?.every((s) => s.note === undefined)).toBe(true);
  });

  it("samples on prune carry drop reasons", () => {
    const event: RecallMetricEvent = {
      stage: "prune",
      workspaceId: "ws-1",
      count: 5,
      extra: { dropped: 2, threshold: 0.88 },
      samples: [
        {
          factId: "f-99",
          score: 0.86,
          preview: "near-dup of f-1",
          note: "cosine > 0.88 near-dup",
        },
      ],
    };
    expect(event.samples?.[0]?.note).toContain("cosine");
  });
});
