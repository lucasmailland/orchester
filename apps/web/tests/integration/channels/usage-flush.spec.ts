// apps/web/tests/integration/channels/usage-flush.spec.ts
//
// COST-5 — a partial/aborted stream must still record usage. We exercise
// the flush path directly: given a conversation + accumulated tokens, a
// usage_event with cost_usd > 0 and an assistant message must be persisted.
import { expect, beforeAll, afterAll, vi, it, beforeEach } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

// COST-5 — drive `handleInboundStream` end-to-end through the no-tools
// streaming path with a controllable `llmStream`. Everything else in the
// module stays real (llmCall, ProviderNotConfiguredError, types) so the
// two direct-flush tests below are unaffected. A test hook lets each case
// swap in the generator it wants the router to consume.
type StreamChunk = import("@/lib/llm-call").LlmStreamChunk;
let nextStream: (() => AsyncGenerator<StreamChunk>) | null = null;
vi.mock("@/lib/llm-call", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/llm-call")>();
  return {
    ...actual,
    llmStream: (..._args: unknown[]) => {
      if (!nextStream) throw new Error("llmStream mock not primed for this test");
      return nextStream();
    },
  };
});

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let wsA: WsFixture;
let flushPartialTurn: typeof import("@/lib/channels/router").flushPartialTurn;
let handleInboundStream: typeof import("@/lib/channels/router").handleInboundStream;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;
let and: typeof import("drizzle-orm").and;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ flushPartialTurn, handleInboundStream } = await import("@/lib/channels/router"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq, and } = await import("drizzle-orm"));
}, 60_000);

beforeEach(() => {
  nextStream = null;
});

afterAll(() => teardownTestWorkspaces());

it("records a usage_event with cost_usd > 0 for an aborted partial stream", async () => {
  const db = getDb();
  const agentId = wsA.agentIds[0]!;
  const channelId = createId();
  await db.insert(schema.channels).values({
    id: channelId,
    workspaceId: wsA.id,
    agentId,
    name: "flush-channel",
    type: "web",
    status: "active",
  });
  const convId = createId();
  await db.insert(schema.conversations).values({
    id: convId,
    workspaceId: wsA.id,
    channelId,
    agentId,
    status: "open",
    externalId: `ext-${createId()}`,
  });

  await flushPartialTurn(wsA.id, agentId, convId, "respuesta parcial…", 1234);

  const usage = await db
    .select()
    .from(schema.usageEvents)
    .where(
      and(eq(schema.usageEvents.workspaceId, wsA.id), eq(schema.usageEvents.agentId, agentId))
    );
  expect(usage.length).toBeGreaterThanOrEqual(1);
  expect(Number(usage[0]!.costUsd)).toBeGreaterThan(0);

  const msgs = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, convId));
  const partial = msgs.find((m) => m.content === "respuesta parcial…");
  expect(partial).toBeTruthy();
  expect(partial!.tokensUsed).toBe(1234);
});

it("is a no-op when tokens == 0 (nothing consumed)", async () => {
  const db = getDb();
  const agentId = wsA.agentIds[1]!;
  const channelId = createId();
  await db.insert(schema.channels).values({
    id: channelId,
    workspaceId: wsA.id,
    agentId,
    name: "flush-noop",
    type: "web",
    status: "active",
  });
  const convId = createId();
  await db.insert(schema.conversations).values({
    id: convId,
    workspaceId: wsA.id,
    channelId,
    agentId,
    status: "open",
    externalId: `ext-${createId()}`,
  });
  await flushPartialTurn(wsA.id, agentId, convId, "", 0);
  const usage = await db
    .select()
    .from(schema.usageEvents)
    .where(
      and(eq(schema.usageEvents.workspaceId, wsA.id), eq(schema.usageEvents.agentId, agentId))
    );
  expect(usage.length).toBe(0);
});

// ---------------------------------------------------------------------------
// COST-5 end-to-end: the fix hoisted `reply`/`tokens`/`persisted` out of the
// `try` in `handleInboundStream` and added `if (!persisted) flushPartialTurn`
// to BOTH catch blocks. Before the fix, an exception thrown mid-stream AFTER
// tokens had accrued discarded them (only the abort + provider-error-chunk
// paths flushed). These tests drive the async generator through the no-tools
// path and force a throw after a `done` chunk, then assert the catch flushed a
// usage_event with cost_usd > 0. If the fix is reverted, no usage_event/
// assistant message is written and the first test goes red.
// ---------------------------------------------------------------------------

/**
 * Seed a fresh no-tools conversational agent + active channel + open
 * conversation, all under wsA. Returns the ids so each test owns its own
 * agent — usage_event counts stay isolated from sibling tests (which is what
 * lets the happy-path "exactly one" assertion be exact). No `tools` column is
 * set, so `handleInboundStream` takes the real-streaming (no-tools) branch.
 */
async function seedStreamAgent(): Promise<{
  agentId: string;
  channelId: string;
  convId: string;
  externalId: string;
}> {
  const db = getDb();
  const agentId = createId();
  await db.insert(schema.agents).values({
    id: agentId,
    workspaceId: wsA.id,
    name: `stream-agent-${agentId.slice(0, 6)}`,
    role: "test",
    systemPrompt: "you are a test agent",
    status: "active",
  });
  const channelId = createId();
  await db.insert(schema.channels).values({
    id: channelId,
    workspaceId: wsA.id,
    agentId,
    name: "stream-channel",
    type: "web",
    status: "active",
  });
  const convId = createId();
  const externalId = `stream-ext-${createId()}`;
  await db.insert(schema.conversations).values({
    id: convId,
    workspaceId: wsA.id,
    channelId,
    agentId,
    status: "open",
    externalId,
  });
  return { agentId, channelId, convId, externalId };
}

it("flushes a usage_event (cost_usd > 0) when the stream THROWS mid-turn after tokens accrued", async () => {
  const db = getDb();
  const { agentId, channelId, externalId } = await seedStreamAgent();

  // Yield a text delta + a `done` carrying tokens (so `reply` and `tokens`
  // are non-zero in the router), THEN throw. The router's `for await` re-
  // raises the throw → the no-tools catch block runs → flushPartialTurn.
  const THROWN_TOKENS = 4200;
  nextStream = async function* () {
    yield { type: "text", delta: "partial answer so far" } as StreamChunk;
    yield { type: "done", tokensUsed: THROWN_TOKENS, model: "claude-sonnet-4-6" } as StreamChunk;
    throw new Error("upstream exploded mid-stream");
  };

  const chunks: Array<{ type: string }> = [];
  for await (const c of handleInboundStream(wsA.id, {
    channelId,
    externalId,
    text: "trigger a throwing stream",
  })) {
    chunks.push(c);
  }

  // The generator must surface an `error` chunk (the catch yields it after
  // flushing) — it must NOT emit `done` (the turn never persisted normally).
  expect(chunks.some((c) => c.type === "error")).toBe(true);
  expect(chunks.some((c) => c.type === "done")).toBe(false);

  // The catch-flush must have billed the accrued tokens: a usage_event scoped
  // to THIS agent with cost_usd > 0. This is the load-bearing assertion — it
  // is exactly what regressed before COST-5.
  const usage = await db
    .select()
    .from(schema.usageEvents)
    .where(
      and(eq(schema.usageEvents.workspaceId, wsA.id), eq(schema.usageEvents.agentId, agentId))
    );
  expect(usage.length).toBe(1);
  expect(Number(usage[0]!.costUsd)).toBeGreaterThan(0);
  expect((usage[0]!.metadata as { tokens?: number }).tokens).toBe(THROWN_TOKENS);

  // …and an assistant message must have been persisted for the conversation
  // with the accrued token count (further proof the flush wrote the turn).
  const convs = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.workspaceId, wsA.id),
        eq(schema.conversations.channelId, channelId),
        eq(schema.conversations.externalId, externalId)
      )
    );
  const msgs = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, convs[0]!.id));
  const assistant = msgs.filter((m) => m.role === "assistant");
  expect(assistant).toHaveLength(1);
  expect(assistant[0]!.tokensUsed).toBe(THROWN_TOKENS);
});

it("bills exactly one usage_event on a clean stream (no double-billing)", async () => {
  const db = getDb();
  const { agentId, channelId, externalId } = await seedStreamAgent();

  // A clean stream: text + done, no throw. The router persists once via the
  // happy path (`persisted = true`), so the catch never runs.
  nextStream = async function* () {
    yield { type: "text", delta: "all good" } as StreamChunk;
    yield { type: "done", tokensUsed: 321, model: "claude-sonnet-4-6" } as StreamChunk;
  };

  const chunks: Array<{ type: string }> = [];
  for await (const c of handleInboundStream(wsA.id, {
    channelId,
    externalId,
    text: "trigger a clean stream",
  })) {
    chunks.push(c);
  }

  expect(chunks.some((c) => c.type === "done")).toBe(true);
  expect(chunks.some((c) => c.type === "error")).toBe(false);

  // Exactly one usage_event — the `persisted` guard means the (never-run)
  // catch could not double-bill.
  const usage = await db
    .select()
    .from(schema.usageEvents)
    .where(
      and(eq(schema.usageEvents.workspaceId, wsA.id), eq(schema.usageEvents.agentId, agentId))
    );
  expect(usage.length).toBe(1);
});
