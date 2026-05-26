// packages/mnemosyne/tests/unit/fact-async.test.ts
//
// Unit-level coverage for `createFactAsync` — verifies that:
//
//  1. When `enqueueEmbed` is supplied, the wrapper inserts the fact
//     with `embedding = NULL` (NEVER calls `embedFn`) and enqueues a
//     `mnemo.embed.fact` job with the (factId, workspaceId, statement)
//     tuple.
//
//  2. When `enqueueEmbed` is NOT supplied, the wrapper falls through
//     to synchronous `createFact` (back-compat — existing call sites
//     keep their behavior).
//
//  3. The wrapper passes the POST-redaction statement to the enqueue
//     callback (so the batch worker embeds the same text that's
//     stored, not the raw input).
//
// We mock the primitive `createFact` so this stays a pure unit test;
// the integration spec in `tests/integration/fact-async-batch.spec.ts`
// exercises the real DB path.

import { describe, it, expect, vi, beforeEach } from "vitest";

const createFactMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/primitives/fact", () => ({
  createFact: createFactMock,
}));

// Imported AFTER the mock so the wrapper sees the mocked createFact.
import { createFactAsync, EMBED_FACT_JOB_NAME } from "../../src/primitives/fact-async";
import type { EnqueueFn } from "../../src/types";
import type { Tx } from "../../src/tx";

const FAKE_TX = {} as unknown as Tx;

function makeFakeFact(overrides: Record<string, unknown> = {}) {
  return {
    id: "mfact_abc123",
    workspaceId: "ws_test",
    agentId: null,
    scope: "global" as const,
    scopeRef: null,
    kind: "preference" as const,
    subject: "user",
    statement: "prefers Spanish",
    confidence: 0.7,
    pinned: false,
    relevance: 1.0,
    hitCount: 0,
    lastRecalledAt: null,
    sourceMessageIds: [],
    attributedTo: null,
    linkedMemoryIds: [],
    embedding: null,
    metadata: {},
    status: "active" as const,
    mergedIntoId: null,
    validFrom: new Date(),
    validTo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  createFactMock.mockReset();
});

describe("createFactAsync — enqueue path", () => {
  it("strips embedding inputs and enqueues a mnemo.embed.fact job", async () => {
    createFactMock.mockResolvedValueOnce(makeFakeFact({ id: "mfact_xyz" }));
    const enqueueEmbed = vi.fn(async (_name: string, _data: Record<string, unknown>) => {});

    const result = await createFactAsync({
      workspaceId: "ws_test",
      scope: "global",
      kind: "preference",
      subject: "user",
      statement: "prefers Spanish",
      // These three MUST be stripped before delegating to createFact —
      // otherwise the sync embedding path would fire.
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      embedFn: vi.fn(),
      enqueueEmbed: enqueueEmbed as unknown as EnqueueFn,
      tx: FAKE_TX,
    });

    // createFact called exactly once, WITHOUT the embedding triple.
    expect(createFactMock).toHaveBeenCalledTimes(1);
    const passedInput = createFactMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(passedInput.embeddingProvider).toBeUndefined();
    expect(passedInput.embeddingModel).toBeUndefined();
    expect(passedInput.embedFn).toBeUndefined();
    expect(passedInput.enqueueEmbed).toBeUndefined();

    // The returned fact is the one createFact produced.
    expect(result.id).toBe("mfact_xyz");

    // enqueueEmbed called with the contract: queue name + payload.
    // v1.6: payload now includes `embeddingTier` (default 'default').
    expect(enqueueEmbed).toHaveBeenCalledTimes(1);
    expect(enqueueEmbed).toHaveBeenCalledWith(EMBED_FACT_JOB_NAME, {
      factId: "mfact_xyz",
      workspaceId: "ws_test",
      statement: "prefers Spanish",
      embeddingTier: "default",
    });
  });

  it("passes the post-redaction statement (from createFact's return) to enqueue", async () => {
    // Simulate PII redaction: input statement contained an email,
    // createFact returned the redacted version.
    createFactMock.mockResolvedValueOnce(
      makeFakeFact({ statement: "contact me at [REDACTED-email]" })
    );
    const enqueueEmbed = vi.fn(async () => {});

    await createFactAsync({
      workspaceId: "ws_test",
      scope: "global",
      kind: "preference",
      subject: "user",
      statement: "contact me at lucas@example.com",
      enqueueEmbed: enqueueEmbed as unknown as EnqueueFn,
      tx: FAKE_TX,
    });

    // The enqueue MUST receive the redacted version — embedding the
    // raw input would leak PII to the embedding provider.
    //
    // v1.6: the payload also carries `embeddingTier` (default 'default'
    // when the caller doesn't override). The PII expectation stays the
    // same; we add the new field to the expected shape.
    expect(enqueueEmbed).toHaveBeenCalledWith(EMBED_FACT_JOB_NAME, {
      factId: expect.any(String),
      workspaceId: "ws_test",
      statement: "contact me at [REDACTED-email]",
      embeddingTier: "default",
    });
  });

  it("propagates enqueue errors (does not swallow)", async () => {
    createFactMock.mockResolvedValueOnce(makeFakeFact());
    const enqueueEmbed = vi.fn().mockRejectedValueOnce(new Error("queue down"));

    await expect(
      createFactAsync({
        workspaceId: "ws_test",
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "fact",
        enqueueEmbed: enqueueEmbed as unknown as EnqueueFn,
        tx: FAKE_TX,
      })
    ).rejects.toThrow("queue down");

    // The fact WAS inserted; the error is post-insert. The caller's
    // try/catch (e.g. extract-job) is responsible for logging.
    expect(createFactMock).toHaveBeenCalledTimes(1);
  });
});

describe("createFactAsync — back-compat path (no enqueueEmbed)", () => {
  it("delegates straight to createFact when enqueueEmbed is omitted", async () => {
    createFactMock.mockResolvedValueOnce(makeFakeFact());

    await createFactAsync({
      workspaceId: "ws_test",
      scope: "global",
      kind: "preference",
      subject: "user",
      statement: "prefers Spanish",
      // Sync path: embedding triple is forwarded as-is to createFact.
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      embedFn: vi.fn(),
      tx: FAKE_TX,
    });

    expect(createFactMock).toHaveBeenCalledTimes(1);
    const passedInput = createFactMock.mock.calls[0]![0] as Record<string, unknown>;
    // Sync path preserves the embedding triple — caller wanted sync.
    expect(passedInput.embeddingProvider).toBe("openai");
    expect(passedInput.embeddingModel).toBe("text-embedding-3-small");
    expect(passedInput.embedFn).toBeDefined();
  });
});
