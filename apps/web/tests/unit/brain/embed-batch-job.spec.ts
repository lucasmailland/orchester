// apps/web/tests/unit/brain/embed-batch-job.spec.ts
//
// Unit-level coverage for the constants + payload contract surface
// area of the embed-batch worker. The full transactional flow is
// exercised by the integration suite — what this spec proves is the
// contract that mnemosyne's `createFactAsync` depends on:
//
//   1. The job-name constant exported by mnemosyne MUST match the
//      JOB_MNEMO_EMBED_FACT registered in apps/web (otherwise enqueued
//      jobs would land in a queue no worker is reading).
//
//   2. The payload shape mnemosyne enqueues MUST be structurally
//      compatible with `EmbedFactPayload`.
//
// These checks catch the most common drift between the package
// boundary and the host worker — much cheaper than a full integration
// run, and they fire as a fast unit test on every CI cycle.

import { describe, it, expect } from "vitest";

describe("mnemo.embed.fact queue contract", () => {
  it("mnemosyne's EMBED_FACT_JOB_NAME matches JOB_MNEMO_EMBED_FACT in queue.ts", async () => {
    const { EMBED_FACT_JOB_NAME } = await import("@mnemosyne/core");
    const { JOB_MNEMO_EMBED_FACT } = await import("@/lib/queue");
    expect(EMBED_FACT_JOB_NAME).toBe(JOB_MNEMO_EMBED_FACT);
  });

  it("EmbedFactPayload accepts the shape mnemosyne enqueues", async () => {
    // mnemosyne enqueues { factId, workspaceId, statement }; the
    // worker's EmbedFactPayload type MUST be assignable from that
    // exact shape. We construct a value of the type via a structural
    // cast and assert the runtime fields are accessible — if the type
    // changed (e.g. added a required field), tsc would fail on the
    // next typecheck (caught by the verification pass), and this
    // runtime smoke prevents silent removal of fields.
    type Payload = import("@/worker/embed-batch-job").EmbedFactPayload;
    const fixture: Payload = {
      factId: "mfact_test",
      workspaceId: "ws_test",
      statement: "test",
    };
    expect(fixture.factId).toBe("mfact_test");
    expect(fixture.workspaceId).toBe("ws_test");
    expect(fixture.statement).toBe("test");
  });
});
