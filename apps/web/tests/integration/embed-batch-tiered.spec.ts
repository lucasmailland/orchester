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

import { createId } from "@paralleldrive/cuid2";
import { schema, type DbClient } from "@orchester/db";
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
let runEmbedBatchSweep: typeof import("@/worker/embed-batch-job").runEmbedBatchSweep;
// Synthetic episode id shared by all 3 seeded facts. Migration 0051 made
// `mnemo_fact.episode_id` NOT NULL, so we create a single throwaway episode
// in beforeAll and point every seeded fact at it. The legacy createFact
// would derive this id per-call via deriveSyntheticEpisodeId; this test
// doesn't exercise episode-derivation logic, so a single shared id is
// behaviorally equivalent for the embed-batch grouping assertions.
let episodeId: string;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("@mnemosyne/core"));
  ({ runEmbedBatchSweep } = await import("@/worker/embed-batch-job"));

  // Seed the throwaway synthetic episode that every fact row will FK to.
  episodeId = `mepi_${createId()}`;
  await withMnemoTx(wsA.id, async (tx) => {
    // Tx cast: withMnemoTx types tx against @mnemosyne/core's schema, but
    // this file uses @orchester/db's schema objects. Drizzle's fluent
    // builder uses SQL column-name strings, not schema identity, so the
    // generated SQL is identical. Safe for fluent builder only.
    const _tx = tx as unknown as DbClient;
    await _tx.insert(schema.mnemoEpisode).values({
      id: episodeId,
      workspaceId: wsA.id,
      title: "(synthetic)",
      narrative: "Auto-created by embed-batch-tiered.spec for episode_id invariant.",
      occurredAt: new Date(),
      participants: [],
      topics: [],
      linkedFactIds: [],
      metadata: {},
      isSynthetic: true,
    });
  });
});
afterAll(() => teardownTestWorkspaces());

describe("embed-batch-job — v1.6 tiered grouping", () => {
  it("groups by tier and issues one embed call per (workspace, tier)", async () => {
    embedCalls.length = 0;

    // Seed: 1 premium-tier fact (pinned trait, workspace-scope) +
    // 2 default-tier facts (conversation-scope, other kind).
    //
    // Direct drizzle inserts (post-Task-10): we replicate the column
    // shape that the legacy `createFact` primitive would have produced,
    // restricted to the fields the embed-batch worker reads. PII
    // redaction / poisoning scans / pointer-index upserts are skipped
    // — none of those gate the embed-batch grouping logic under test.
    await withMnemoTx(wsA.id, async (tx) => {
      // Tx cast: withMnemoTx types tx against @mnemosyne/core's schema,
      // but this file uses @orchester/db's schema objects. Drizzle's
      // fluent builder uses SQL column-name strings, not schema identity,
      // so the generated SQL is identical. Safe for fluent builder only.
      const _tx = tx as unknown as DbClient;
      await _tx.insert(schema.mnemoFacts).values({
        id: `mfact_${createId()}`,
        episodeId,
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "premium fact: pinned trait about the user",
        confidence: 0.7,
        pinned: true,
        relevance: 1.0,
        hitCount: 0,
        sourceMessageIds: [],
        // embedding-tier hint lives in metadata.embedding_tier — the
        // batch worker groups pending facts by this JSONB path.
        metadata: { embedding_tier: "premium" },
        status: "active",
        memoryType: "semantic",
        attribution: "inferred",
        protocolVersion: "v1.1",
      });
      await _tx.insert(schema.mnemoFacts).values({
        id: `mfact_${createId()}`,
        episodeId,
        workspaceId: wsA.id,
        scope: "conversation",
        kind: "other",
        subject: "user",
        statement: "default fact A: random conversation detail",
        confidence: 0.7,
        pinned: false,
        relevance: 1.0,
        hitCount: 0,
        sourceMessageIds: [],
        metadata: { embedding_tier: "default" },
        status: "active",
        memoryType: "semantic",
        attribution: "inferred",
        protocolVersion: "v1.1",
      });
      await _tx.insert(schema.mnemoFacts).values({
        id: `mfact_${createId()}`,
        episodeId,
        workspaceId: wsA.id,
        scope: "conversation",
        kind: "other",
        subject: "user",
        statement: "default fact B: another random detail",
        confidence: 0.7,
        pinned: false,
        relevance: 1.0,
        hitCount: 0,
        sourceMessageIds: [],
        metadata: { embedding_tier: "default" },
        status: "active",
        memoryType: "semantic",
        attribution: "inferred",
        protocolVersion: "v1.1",
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
