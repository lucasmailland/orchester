// apps/web/__tests__/phase-f2-flow-engine-rls.test.ts
//
// Regression suite for Phase F.2 (post-2026-05-26):
//   `withFlowTx` in `lib/flow-engine.ts` was missing the
//   `SET LOCAL ROLE app_user` statement. Without it, when the
//   connection role is `rolbypassrls=t` (the deployed `orchester`
//   role per the 2026-05-24 audit P0), FORCE RLS is silently
//   bypassed for the whole flow run — every `app.workspace_id` GUC
//   set inside `withFlowTx` is decorative.
//
// The fix (one line, prepended) is:
//
//   return db.transaction(async (tx) => {
//     await tx.execute(sql`SET LOCAL ROLE app_user`);                                          // F.2
//     await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
//     return fn(tx);
//   });
//
// The ORDER matters. If anyone reorders these two lines (puts the
// GUC first, then SET LOCAL ROLE app_user), Postgres still applies
// `set_config(..., true)` to the elevated role's transaction — but
// then the role downgrade happens AFTER, which means any read
// performed by `fn(tx)` runs as `app_user` (good) while the GUC was
// set by the elevated role (irrelevant — `set_config(..., true)`
// is per-transaction, so it survives). So the ordering is mostly
// defensive against future "let me batch these together" rewrites
// that lift the role out of the transaction entirely. We still
// assert order strictly: the contract is "downgrade FIRST".
//
// `withFlowTx` is module-private, so we drive it through
// `executeFlow(...)` — its first action is `await withFlowTx(...)`,
// and our mocked `db.transaction` records every `tx.execute(...)` in
// the order it's called. The first two MUST be the role downgrade
// followed by the GUC set.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeCalls, transactionMock } = vi.hoisted(() => {
  // Each tx.execute() call captures the rendered SQL text. Drizzle's
  // `sql` template tag returns a SQL object; we read the embedded
  // strings out of it via the `queryChunks` array — that's the
  // template literal's static segments interleaved with parameter
  // placeholders. Good enough to verify SET LOCAL ROLE / set_config.
  const executeCalls: string[] = [];

  // Build a "tx" that satisfies the minimal contract `withFlowTx +
  // executeFlow` need:
  //   tx.execute(sql) → resolves
  //   tx.select().from().where().limit() → resolves to [{ ... flow row }]
  //   tx.update().set().where() → resolves
  //   tx.insert().values() → resolves
  const flowRow = {
    id: "flow_test",
    workspaceId: "ws_test",
    // Trigger-only flow → execution short-circuits to failure quickly,
    // but BEFORE the failure path, withFlowTx fires AT LEAST twice
    // (flow lookup + flow_run insert). Both invocations must exhibit
    // the role-first / GUC-second pattern. We assert on the FIRST
    // invocation's order because it's the one that always fires.
    nodes: [], // no trigger → executeFlow returns early with "no start" error
    edges: [],
    variables: {},
  };

  const makeTx = (): unknown => ({
    execute: vi.fn(async (sqlObj: { queryChunks?: unknown[] }) => {
      // Drizzle SQL: `queryChunks` is an array of StringChunk objects
      // (with `.value`) and Param objects. We stringify the static
      // text portions so the test can assert on the rendered SQL.
      const chunks = sqlObj?.queryChunks ?? [];
      const rendered = chunks
        .map((c: unknown) => {
          if (c && typeof c === "object" && "value" in c) {
            // StringChunk has a `value: string[]` per drizzle 0.45
            const v = (c as { value: unknown }).value;
            return Array.isArray(v) ? v.join("") : String(v);
          }
          // Param objects — render as <param>
          return "<param>";
        })
        .join("");
      executeCalls.push(rendered);
      return { rows: [] };
    }),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([flowRow]),
    limit: vi.fn().mockResolvedValue([flowRow]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  });

  // db.transaction(fn) → runs fn with a fresh tx mock. Real Drizzle
  // semantics return whatever the callback returned.
  const transactionMock = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = makeTx();
    // The select chain inside `withFlowTx` (flowRows = await tx.select()
    // .from().where().limit()) must resolve to [flowRow]. Make `.where`
    // chain into `.limit` then resolve.
    (tx as { where: ReturnType<typeof vi.fn> }).where = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([flowRow]),
    });
    return fn(tx);
  });
  return { executeCalls, transactionMock };
});

// `@orchester/db` — getDb() returns an object with `transaction`.
// Drizzle's `sql` tag still goes through the real `drizzle-orm`
// import below so SQL objects have the expected shape.
vi.mock("@orchester/db", () => ({
  getDb: vi.fn(() => ({
    transaction: transactionMock,
  })),
  schema: {
    flows: {
      id: "flows.id",
      workspaceId: "flows.workspaceId",
    },
    flowRuns: {
      id: "flowRuns.id",
    },
  },
}));

// Keep drizzle-orm real so the `sql` template tag produces actual
// SQL objects with the `queryChunks` shape our mock inspects.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return actual;
});

// `enqueue` / `queue` is reached if execution branches further; stub.
vi.mock("@/lib/queue", () => ({
  enqueue: vi.fn(),
  JOB_FLOW_RUN: "flow.run",
}));

vi.mock("@/lib/net-guard", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("@/lib/observability", () => ({
  recordMetric: vi.fn(),
  logWithContext: vi.fn(),
}));
vi.mock("@/lib/llm-call", () => ({
  llmCall: vi.fn(),
  llmStream: vi.fn(),
}));
vi.mock("@paralleldrive/cuid2", () => ({
  createId: () => "run_id_xyz",
}));

beforeEach(() => {
  executeCalls.length = 0;
  transactionMock.mockClear();
});

describe("Phase F.2 regression — withFlowTx sets app_user role BEFORE the workspace GUC", () => {
  it("first tx.execute() call is SET LOCAL ROLE app_user", async () => {
    const { executeFlow } = await import("../lib/flow-engine");

    // No trigger node → executeFlow returns { status: "failed" } after
    // the first withFlowTx invocation (flow lookup). That's enough to
    // assert ordering on the first transaction.
    await executeFlow({
      flowId: "flow_test",
      workspaceId: "ws_test",
      triggerSource: "test",
      input: {},
    });

    // At minimum the flow-lookup withFlowTx must have run → 2 execute
    // calls (SET LOCAL ROLE app_user + set_config) before the SELECT.
    expect(executeCalls.length).toBeGreaterThanOrEqual(2);

    // ── THE INVARIANT ──────────────────────────────────────────────
    // First execute MUST be the role downgrade. Anywhere else and
    // FORCE RLS may be bypassed for the SELECT.
    expect(executeCalls[0]).toContain("SET LOCAL ROLE app_user");
  });

  it("second tx.execute() call is set_config('app.workspace_id', ...)", async () => {
    const { executeFlow } = await import("../lib/flow-engine");

    await executeFlow({
      flowId: "flow_test",
      workspaceId: "ws_test",
      triggerSource: "test",
      input: {},
    });

    // The set_config call binds `app.workspace_id` for the duration
    // of the transaction. It MUST come right after the role downgrade.
    expect(executeCalls[1]).toContain("set_config");
    expect(executeCalls[1]).toContain("app.workspace_id");
  });

  it("EVERY withFlowTx invocation re-establishes the role + GUC (no leaking across calls)", async () => {
    const { executeFlow } = await import("../lib/flow-engine");

    await executeFlow({
      flowId: "flow_test",
      workspaceId: "ws_test",
      triggerSource: "test",
      input: {},
    });

    // For a no-trigger flow we get at least two withFlowTx calls
    // (lookup + state update on the failure path). The expected
    // shape of `executeCalls` is therefore:
    //   ["SET LOCAL ROLE app_user", "...set_config('app.workspace_id'...",
    //    "SET LOCAL ROLE app_user", "...set_config('app.workspace_id'...",
    //    ...]
    // Walk in pairs and verify the invariant holds for every pair.
    const txCount = transactionMock.mock.calls.length;
    expect(txCount).toBeGreaterThanOrEqual(2);

    // Every (2k, 2k+1) pair must be (role, guc) — proves NO call to
    // withFlowTx ever skips the role downgrade. If a future refactor
    // adds a "fast path" that omits the role for some withFlowTx
    // codepath, this assertion fires.
    for (let i = 0; i < executeCalls.length; i += 2) {
      const role = executeCalls[i];
      const guc = executeCalls[i + 1];
      if (role === undefined || guc === undefined) break;
      // Skip pairs that aren't from withFlowTx (defence in depth: if
      // any future executeFlow code does its own raw `tx.execute()`
      // we don't want to falsely fail).
      if (!role.includes("SET LOCAL ROLE") && !guc.includes("set_config")) continue;
      expect(role).toContain("SET LOCAL ROLE app_user");
      expect(guc).toContain("set_config");
      expect(guc).toContain("app.workspace_id");
    }
  });

  it("the role downgrade comes BEFORE the GUC (order is the security property)", async () => {
    // This is the explicit regression assertion: if someone reorders
    // the two `tx.execute(sql\`...\`)` lines in withFlowTx, the
    // ordering invariant breaks here.
    const { executeFlow } = await import("../lib/flow-engine");

    await executeFlow({
      flowId: "flow_test",
      workspaceId: "ws_test",
      triggerSource: "test",
      input: {},
    });

    const roleIdx = executeCalls.findIndex((c) => c.includes("SET LOCAL ROLE app_user"));
    const gucIdx = executeCalls.findIndex((c) => c.includes("app.workspace_id"));
    expect(roleIdx).toBeGreaterThanOrEqual(0);
    expect(gucIdx).toBeGreaterThanOrEqual(0);
    // ORDER: role must strictly precede the first GUC set.
    expect(roleIdx).toBeLessThan(gucIdx);
  });
});
