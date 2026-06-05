// apps/web/tests/integration/embed-batch-tiered.spec.ts
//
// Mnemosyne v1.6 — Integration test for the tiered embed-batch worker.
//
// Seeds a pinned-trait fact (premium tier) + a regular conversation
// fact (default tier) in the same workspace, runs the batch sweep,
// and verifies that the embedding callback receives TWO calls — one
// per tier — with different models.
//
// We mock `embed()` from `@/lib/embeddings` to capture calls without
// hitting any external API. The DB layer + mnemo_fact metadata read
// is exercised end-to-end against the real Postgres testcontainer.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";

// Provider+model captures per call. The mock returns deterministic
// vectors so the row write succeeds.
const embedCalls: Array<{ provider: string; model: string; texts: string[] }> = [];

vi.mock("@/lib/embeddings", () => ({
  embed: async (
    _workspaceId: string,
    provider: string,
    model: string,
    texts: string[],
    _tx: unknown
  ) => {
    embedCalls.push({ provider, model, texts });
    const vectors = texts.map(() => new Array(1536).fill(0.01));
    return { vectors, model, tokensUsed: texts.length * 10 };
  },
  defaultEmbeddingModel: (provider: string) =>
    provider === "openai" ? "text-embedding-3-small" : "text-embedding-004",
}));

// Cost-alerts + ai/run: no-op so the audit invariants still trigger
// (the substring scan in `audit-invariants.sh` only checks the file
// _contains_ the names — runtime is irrelevant for the test).
vi.mock("@/lib/cost-alerts", () => ({
  assertWithinSpend: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/run", () => ({
  recordAiUsage: vi.fn(async () => undefined),
}));
vi.mock("@/lib/pricing", () => ({
  calculateEmbeddingCostUsd: vi.fn(() => 0),
}));
vi.mock("@/lib/safe-log", () => ({ safeLogError: vi.fn() }));

// Tier resolver stub — returns provider+model based on the tier passed.
// We bypass the real DB-backed resolver to keep the test focused on
// the grouping behaviour, not the (separately-tested) tier resolution.
vi.mock("@/lib/ai/embedding-tier", () => ({
  resolveEmbeddingTier: async ({ tier }: { tier: "default" | "premium" }) => {
    if (tier === "premium") {
      return {
        tier: "premium",
        provider: "voyage" as const,
        model: "voyage-3-large",
      };
    }
    return {
      tier: "default",
      provider: "openai" as const,
      model: "text-embedding-3-small",
    };
  },
}));

let wsA: WsFixture;
let withMnemoTx: typeof import("@mnemosyne/core").withMnemoTx;
// Cast: createFact lives on the package's internal primitives surface
// area. We resolve it via the same dynamic import path used by
// fact-async-batch.spec.ts (relative — the integration tests in
// `packages/mnemosyne/tests` use `../../src/primitives/fact`).
type CreateFactFn = typeof import("../../../../packages/mnemosyne/src/primitives/fact").createFact;
let createFact: CreateFactFn;
let runEmbedBatchSweep: typeof import("@/worker/embed-batch-job").runEmbedBatchSweep;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("@mnemosyne/core"));
  ({ createFact } =
    (await import("../../../../packages/mnemosyne/src/primitives/fact")) as unknown as {
      createFact: CreateFactFn;
    });
  ({ runEmbedBatchSweep } = await import("@/worker/embed-batch-job"));
});
afterAll(() => teardownTestWorkspaces());

describe("embed-batch-job — v1.6 tiered grouping", () => {
  it("groups by tier and issues one embed call per (workspace, tier)", async () => {
    embedCalls.length = 0;

    // Seed: 1 premium-tier fact (pinned trait, workspace-scope) +
    // 2 default-tier facts (conversation-scope, other kind).
    await withMnemoTx(wsA.id, async (tx) => {
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "premium fact: pinned trait about the user",
        pinned: true,
        embeddingTier: "premium",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        scope: "conversation",
        kind: "other",
        subject: "user",
        statement: "default fact A: random conversation detail",
        embeddingTier: "default",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        scope: "conversation",
        kind: "other",
        subject: "user",
        statement: "default fact B: another random detail",
        embeddingTier: "default",
        tx,
      });
    });

    // Run the cross-tenant sweep. It enumerates workspaces with
    // pending unembedded facts and flushes them per workspace.
    await runEmbedBatchSweep();

    // Expect 2 embed calls — one per tier — with different models.
    expect(embedCalls.length).toBe(2);
    const calls = embedCalls.slice().sort((a, b) => a.provider.localeCompare(b.provider));
    expect(calls[0]?.provider).toBe("openai");
    expect(calls[0]?.model).toBe("text-embedding-3-small");
    expect(calls[0]?.texts).toHaveLength(2); // 2 default-tier facts
    expect(calls[1]?.provider).toBe("voyage");
    expect(calls[1]?.model).toBe("voyage-3-large");
    expect(calls[1]?.texts).toHaveLength(1); // 1 premium-tier fact
    expect(calls[1]?.texts[0]).toContain("premium fact");
  });
});
