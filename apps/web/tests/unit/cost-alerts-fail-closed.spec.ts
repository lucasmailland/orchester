// apps/web/tests/unit/cost-alerts-fail-closed.spec.ts
//
// Unit test for the differentiated fail-mode in `assertWithinSpend`.
//
// The function reads month-to-date spend from `usage_event` and compares
// it against `AI_MONTHLY_SPEND_CAP_USD`. The DB read can fail two ways:
//
//   - permission denied (SQLSTATE 42501 or our `RLS_DENIED` code) —
//     someone removed the GRANT or the GUC isn't set; the cap is being
//     silently bypassed. Fail CLOSED (throw SpendGuardError) so the
//     misconfiguration surfaces immediately.
//
//   - everything else (network blip, timeout, transient pool issue) —
//     fail OPEN so a DB hiccup doesn't take the product down.
//
// We mock the schema-aware drizzle path so the spend-read path is the
// only thing exercised. The mock injects the error code shape we want
// to test (`code: "42501"` etc.).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// IMPORTANT: must mock BEFORE importing the module under test so the
// import inside `cost-alerts.ts` resolves to our stub.
const selectMock = vi.fn();
vi.mock("@orchester/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => selectMock(),
      }),
    }),
  }),
  schema: {
    usageEvents: {
      costUsd: "costUsd",
      workspaceId: "workspaceId",
      createdAt: "createdAt",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  gte: (...args: unknown[]) => args,
  sql: () => "sql-tag",
}));

// Also stub the heavier helpers cost-alerts pulls in lazily.
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/webhooks-out", () => ({ dispatchEvent: vi.fn() }));
vi.mock("@/lib/employee-budget", () => ({ checkEmployeeBudget: vi.fn() }));

// Quiet the structured logger output during the test.
vi.mock("@/lib/safe-log", () => ({
  safeLogError: vi.fn(),
  safeLogWarn: vi.fn(),
}));

let assertWithinSpend: typeof import("@/lib/cost-alerts").assertWithinSpend;
let SpendGuardError: typeof import("@/lib/cost-alerts").SpendGuardError;

const ORIGINAL_CAP = process.env.AI_MONTHLY_SPEND_CAP_USD;

beforeEach(async () => {
  selectMock.mockReset();
  // Force a cap to be configured so the spend read actually executes.
  process.env.AI_MONTHLY_SPEND_CAP_USD = "100";
  vi.resetModules();
  ({ assertWithinSpend, SpendGuardError } = await import("@/lib/cost-alerts"));
});

afterEach(() => {
  if (ORIGINAL_CAP === undefined) {
    delete process.env.AI_MONTHLY_SPEND_CAP_USD;
  } else {
    process.env.AI_MONTHLY_SPEND_CAP_USD = ORIGINAL_CAP;
  }
});

describe("assertWithinSpend fail-mode", () => {
  it("fail-CLOSED (throws) when the spend read hits a 42501 permission error", async () => {
    const err = Object.assign(new Error("permission denied for relation usage_event"), {
      code: "42501",
    });
    selectMock.mockRejectedValueOnce(err);

    await expect(assertWithinSpend("ws_x")).rejects.toBeInstanceOf(SpendGuardError);
  });

  it("fail-CLOSED (throws) when the read hits a custom RLS_DENIED code", async () => {
    const err = Object.assign(new Error("RLS rejected"), { code: "RLS_DENIED" });
    selectMock.mockRejectedValueOnce(err);

    await expect(assertWithinSpend("ws_x")).rejects.toBeInstanceOf(SpendGuardError);
  });

  it("fail-CLOSED (throws) on a generic network / connection error (COST-6)", async () => {
    const err = Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
    selectMock.mockRejectedValueOnce(err);

    // With a cap set, ANY DB error fails CLOSED — a network blip must not
    // silently disable the only hard money cap.
    await expect(assertWithinSpend("ws_x")).rejects.toBeInstanceOf(SpendGuardError);
  });

  it("fail-CLOSED (throws) on a code-less error (COST-6)", async () => {
    selectMock.mockRejectedValueOnce(new Error("some opaque failure"));
    await expect(assertWithinSpend("ws_x")).rejects.toBeInstanceOf(SpendGuardError);
  });

  it("fail-CLOSED (throws) when the spend read times out (57014) (COST-6)", async () => {
    const err = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });
    selectMock.mockRejectedValueOnce(err);
    await expect(assertWithinSpend("ws_x")).rejects.toBeInstanceOf(SpendGuardError);
  });

  it("happy path: spend under cap → resolves without throwing", async () => {
    selectMock.mockResolvedValueOnce([{ total: "12.34" }]);
    await expect(assertWithinSpend("ws_x")).resolves.toBeUndefined();
  });

  it("happy path: spend over cap → throws SpendGuardError", async () => {
    selectMock.mockResolvedValueOnce([{ total: "150.00" }]);
    await expect(assertWithinSpend("ws_x")).rejects.toBeInstanceOf(SpendGuardError);
  });
});
