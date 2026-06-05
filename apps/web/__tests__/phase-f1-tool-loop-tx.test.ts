// apps/web/__tests__/phase-f1-tool-loop-tx.test.ts
//
// Regression suite for Phase F.1 (post-2026-05-26):
//   The LLM tool loop used to open a nested `getDb()` connection
//   during `runConversationalTurn`, which fell back on the BYPASSRLS
//   connection role for `ai_provider` reads. The fix:
//     1. Thread an optional `tx?: WsDb` through `llmCall` / `llmStream`.
//     2. The internal `getProviderKey(workspaceId, provider, tx?)`
//        uses the threaded `tx` when present; otherwise it opens a
//        short workspace-scoped tx via the new `withWorkspaceTx`
//        helper exported from `lib/tenant/context.ts`.
//
// `getProviderKey` is module-private, so we exercise the contract
// through `llmCall(...)` — the only public entry point that funnels
// into it. The assertions check the OBSERVABLE behaviour:
//
//   • Calling `llmCall` WITHOUT `tx` MUST cause `withWorkspaceTx` to
//     fire (the helper that sets `SET LOCAL ROLE app_user` + the
//     `app.workspace_id` GUC). If a future refactor drops the
//     `if (!tx)` branch, `withWorkspaceTx` would not be called and
//     this test fails.
//
//   • Calling `llmCall` WITH `tx` MUST NOT call `withWorkspaceTx`.
//     If a future refactor accidentally re-opens a nested tx,
//     `withWorkspaceTx` would be observed as called and this test
//     fails.
//
// Both tests stub the actual provider HTTP layer (we don't care what
// happens after key resolution) and assert only on the tx wiring.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mock state ────────────────────────────────────────────
// `vi.mock` factories run before module-eval, so any spies they reach
// must be defined inside `vi.hoisted` (otherwise the spy variable is
// in the temporal dead zone at hoist time). Mirrors the convention
// used in `__tests__/agent-handoff.test.ts`.
const { withWorkspaceTxMock, txSelectChain, encryptedKey } = vi.hoisted(() => {
  // The `tx` we hand back: a thenable-friendly fluent select chain.
  // `getProviderKey` issues exactly: tx.select().from(...).where(...).limit(1)
  // and inspects the returned row's `apiKey` + `endpoint` + `enabled`.
  const txSelectChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([
      {
        apiKey: "encrypted-fake-blob",
        endpoint: null,
        enabled: true,
        provider: "anthropic",
        workspaceId: "ws_test",
      },
    ]),
  };
  const withWorkspaceTxMock = vi.fn(
    async (_ws: string, fn: (tx: typeof txSelectChain) => unknown) => fn(txSelectChain)
  );
  return {
    withWorkspaceTxMock,
    txSelectChain,
    encryptedKey: "encrypted-fake-blob",
  };
});

// `@/lib/tenant/context.ts` is "server-only" + imports next/headers.
// We mock the entire module so the test never resolves
// `next/headers`. Only `withWorkspaceTx` is used by llm-call.
vi.mock("@/lib/tenant/context", () => ({
  withWorkspaceTx: withWorkspaceTxMock,
  withTenantContext: vi.fn(),
  requireTenantContext: vi.fn(),
  TenantContextError: class TenantContextError extends Error {},
}));

// Make `@orchester/db` deterministic. The global setup mock returns
// `getDb()` => {}, which is fine here because the tx threading path
// never touches `getDb()` directly — it goes through `withWorkspaceTx`,
// which we control above.
vi.mock("@orchester/db", () => ({
  getDb: vi.fn(() => ({})),
  schema: {
    aiProviders: {
      workspaceId: "aiProviders.workspaceId",
      provider: "aiProviders.provider",
    },
  },
}));

// drizzle-orm operators — `getProviderKey` builds `and(eq(...), eq(...))`.
// We don't care what the predicates look like, only that the chain runs.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
    and: (...xs: unknown[]) => ({ and: xs }),
  };
});

// `decrypt` would otherwise demand an `ENCRYPTION_SECRET` env var. We
// only need the path "fake-blob" → "fake-decrypted-key" so the rest
// of `llmCall` can proceed without throwing.
vi.mock("@/lib/encryption", () => ({
  decrypt: vi.fn((_: string) => "sk-ant-fake-decrypted"),
  encrypt: vi.fn(),
  maskKey: vi.fn(),
}));

// Resolve any chat model to a known provider so we can predict the
// outbound branch. The real catalog has 50+ models; only `provider.id`
// and `provider.family` are used by `llmCallInner`.
vi.mock("@/lib/ai/catalog", () => ({
  resolveModel: vi.fn((_id: string) => ({
    provider: { id: "anthropic", family: "anthropic", name: "Anthropic" },
    capability: "chat",
    model: "claude-haiku-4-5",
    modelId: "anthropic:claude-haiku-4-5",
  })),
}));

// Stub the actual HTTP call to Anthropic so the test never opens a
// network socket. Returning a sane LlmCallResult lets `llmCall`
// complete and we can also exercise the post-key path.
vi.mock("@/lib/http-util", () => ({
  fetchWithTimeout: vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          id: "msg_test",
          content: [{ type: "text", text: "hi" }],
          usage: { input_tokens: 5, output_tokens: 3 },
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  ),
  fetchStreamWithConnectTimeout: vi.fn(),
  withRetry: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string
    ) {
      super(message);
    }
  },
}));

vi.mock("@/lib/observability", () => ({
  recordMetric: vi.fn(),
  logWithContext: vi.fn(),
}));

// Capabilities is a pure type module; the runtime side has no
// behaviour we care about.
vi.mock("@/lib/ai/capabilities", () => ({}));

beforeEach(() => {
  withWorkspaceTxMock.mockClear();
  txSelectChain.select.mockClear();
  txSelectChain.from.mockClear();
  txSelectChain.where.mockClear();
  txSelectChain.limit.mockClear();
  txSelectChain.limit.mockResolvedValue([
    {
      apiKey: encryptedKey,
      endpoint: null,
      enabled: true,
      provider: "anthropic",
      workspaceId: "ws_test",
    },
  ]);
});

describe("Phase F.1 regression — tool loop threads tx through to getProviderKey", () => {
  it("getProviderKey opens its own workspace tx when caller has no tx (llmCall without tx)", async () => {
    const { llmCall } = await import("../lib/llm-call");

    await llmCall({
      workspaceId: "ws_test",
      model: "claude-haiku-4-5",
      systemPrompt: "you are a test agent",
      messages: [{ role: "user", content: "hi" }],
    });

    // The ENTIRE point of F.1: without a caller-provided tx,
    // `getProviderKey` MUST delegate to `withWorkspaceTx`, which is
    // what sets `SET LOCAL ROLE app_user` + the workspace GUC. If
    // someone removes the `if (!tx)` branch and falls back on a raw
    // `getDb()`, FORCE RLS rejects the SELECT and the elevated
    // BYPASSRLS connection silently leaks rows across tenants.
    expect(withWorkspaceTxMock).toHaveBeenCalledTimes(1);
    expect(withWorkspaceTxMock).toHaveBeenCalledWith("ws_test", expect.any(Function));

    // And the select went through the tx supplied by withWorkspaceTx,
    // proving the inner recursion (`getProviderKey(ws, prov, innerTx)`)
    // actually uses the tx instead of re-opening getDb().
    expect(txSelectChain.select).toHaveBeenCalledTimes(1);
    expect(txSelectChain.limit).toHaveBeenCalledTimes(1);
  });

  it("getProviderKey reuses the caller's tx when one is provided (no nested workspace tx)", async () => {
    const { llmCall } = await import("../lib/llm-call");

    // A caller-provided tx mock — same shape as the one withWorkspaceTx
    // would hand us. The select chain reports a different `apiKey`
    // marker so we can also distinguish that THIS tx (not the
    // withWorkspaceTx fallback) ran the query.
    const callerTxLimit = vi.fn().mockResolvedValue([
      {
        apiKey: "caller-supplied-blob",
        endpoint: null,
        enabled: true,
        provider: "anthropic",
        workspaceId: "ws_test",
      },
    ]);
    // Cast to the WsDb branded type at the boundary. `llmCall` declares
    // `tx?: WsDb` (DbClient | TxArg), and our fake is structurally
    // compatible for the only methods invoked. Using NonNullable strips
    // the `| undefined` that `Parameters<...>[0]["tx"]` carries under
    // exactOptionalPropertyTypes — we're explicitly passing a defined
    // tx in this test.
    const callerTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: callerTxLimit,
    } as unknown as NonNullable<Parameters<typeof llmCall>[0]["tx"]>;

    await llmCall({
      workspaceId: "ws_test",
      model: "claude-haiku-4-5",
      systemPrompt: "you are a test agent",
      messages: [{ role: "user", content: "hi" }],
      tx: callerTx,
    });

    // Caller provided a tx → withWorkspaceTx MUST NOT fire.
    // If a future refactor accidentally re-opens a workspace tx,
    // we'd see >0 calls here. That's the exact regression F.1 fixed.
    expect(withWorkspaceTxMock).not.toHaveBeenCalled();

    // The provider-key SELECT MUST have run on the caller-supplied tx.
    expect(callerTxLimit).toHaveBeenCalledTimes(1);
    // And NOT on the default tx-chain that withWorkspaceTx would have
    // produced.
    expect(txSelectChain.limit).not.toHaveBeenCalled();
  });

  it("propagates ProviderNotConfiguredError when no row is returned (sanity: SELECT actually ran)", async () => {
    txSelectChain.limit.mockResolvedValueOnce([]);
    const { llmCall, ProviderNotConfiguredError } = await import("../lib/llm-call");
    await expect(
      llmCall({
        workspaceId: "ws_test",
        model: "claude-haiku-4-5",
        systemPrompt: "x",
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);

    // Even on failure, the workspace tx MUST have been opened — proof
    // the fallback path is active before the empty-row check trips.
    expect(withWorkspaceTxMock).toHaveBeenCalledTimes(1);
  });
});
