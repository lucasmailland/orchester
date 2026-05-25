// packages/mnemosyne/tests/integration/summary.spec.ts
//
// Integration tests for `getOrComputeSummary` against a real Postgres.
// Covers the caching contract, forceRefresh, invalidate, and the
// "uses LLM when supplied" path via a mock `llm` callback.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;
let createFact: typeof import("../../src/primitives/fact").createFact;
let getOrComputeSummary: typeof import("../../src/summary").getOrComputeSummary;
let getSummary: typeof import("../../src/summary").getSummary;
let invalidateSummary: typeof import("../../src/summary").invalidateSummary;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ getOrComputeSummary, getSummary, invalidateSummary } = await import("../../src/summary"));
});

afterAll(() => teardownTestWorkspaces());

describe("summary/getOrComputeSummary", () => {
  it("returns null when the workspace has no facts (cold start)", async () => {
    const agentId = wsA.agentIds[0]!;
    const summary = await getOrComputeSummary({
      workspaceId: wsA.id,
      agentId,
    });
    expect(summary).toBeNull();
  });

  it("distills via mock LLM and caches the result for 24h", async () => {
    const agentId = wsA.agentIds[1]!;

    // Seed 5 representative facts for this agent.
    await withMnemoTx(wsA.id, async (tx) => {
      await createFact({
        workspaceId: wsA.id,
        agentId,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "Lucas is based in Buenos Aires, Argentina",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        agentId,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prefers TypeScript over JavaScript for new projects",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        agentId,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prefers Postgres for production databases always",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        agentId,
        scope: "global",
        kind: "skill",
        subject: "user",
        statement: "experienced with Next.js and React server components",
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        agentId,
        scope: "global",
        kind: "concern",
        subject: "deploy_region",
        statement: "still unsure whether to deploy in us-east-1 or eu-west-1",
        tx,
      });
    });

    // Mock LLM that returns a deterministic JSON profile.
    const llmCalls: string[] = [];
    const llm = vi.fn(async ({ prompt }: { prompt: string }) => {
      llmCalls.push(prompt);
      return JSON.stringify({
        identity: "Lucas | AR/BA",
        role: "Engineer",
        techStack: "TypeScript, Postgres, Next.js",
        openDecisions: ["deploy_region"],
      });
    });

    const first = await getOrComputeSummary({
      workspaceId: wsA.id,
      agentId,
      llm,
      model: "test:fast",
    });
    expect(first).not.toBeNull();
    expect(first!.identity).toBe("Lucas | AR/BA");
    expect(first!.techStack).toContain("TypeScript");
    expect(first!.openDecisions).toEqual(["deploy_region"]);
    expect(first!.sourceFactIds.length).toBeGreaterThanOrEqual(5);
    expect(first!.tokenCount).toBeGreaterThan(0);
    expect(first!.freshness).toBe("fresh");
    expect(llm).toHaveBeenCalledTimes(1);

    // Persisted to mnemo_summary.
    const row = await withMnemoTx(wsA.id, (tx) => getSummary(wsA.id, agentId, null, tx));
    expect(row).not.toBeNull();
    expect(row!.modelUsed).toBe("test:fast");
    expect(row!.summaryText).toContain("Lucas | AR/BA");

    // Second call within TTL → cache hit, NO new LLM call.
    const second = await getOrComputeSummary({
      workspaceId: wsA.id,
      agentId,
      llm,
      model: "test:fast",
    });
    expect(second).not.toBeNull();
    expect(second!.identity).toBe("Lucas | AR/BA");
    expect(llm).toHaveBeenCalledTimes(1); // unchanged

    // forceRefresh → recompute (LLM called again).
    const third = await getOrComputeSummary({
      workspaceId: wsA.id,
      agentId,
      llm,
      model: "test:fast",
      forceRefresh: true,
    });
    expect(third).not.toBeNull();
    expect(llm).toHaveBeenCalledTimes(2);
  });

  it("invalidateSummary forces the next call to recompute", async () => {
    const agentId = wsA.agentIds[1]!;

    let llmHits = 0;
    const llm = vi.fn(async () => {
      llmHits += 1;
      return JSON.stringify({
        identity: `Lucas v${llmHits}`,
      });
    });

    // Prime the cache.
    const before = await getOrComputeSummary({
      workspaceId: wsA.id,
      agentId,
      llm,
      model: "test:fast",
      forceRefresh: true,
    });
    expect(before).not.toBeNull();
    const beforeHits = llmHits;

    // Same-call again — cache hit, no LLM.
    await getOrComputeSummary({
      workspaceId: wsA.id,
      agentId,
      llm,
      model: "test:fast",
    });
    expect(llmHits).toBe(beforeHits);

    // Invalidate then call again — LLM must run.
    await withMnemoTx(wsA.id, (tx) => invalidateSummary(wsA.id, agentId, null, tx));
    const after = await getOrComputeSummary({
      workspaceId: wsA.id,
      agentId,
      llm,
      model: "test:fast",
    });
    expect(after).not.toBeNull();
    expect(llmHits).toBe(beforeHits + 1);
  });
});
