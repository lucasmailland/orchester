// apps/web/tests/integration/billing/webhook-idempotency.spec.ts
//
// COST-9 — Stripe webhook idempotency + payment-failure flag.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let withCrossTenantAdmin: typeof import("@/lib/tenant/cron").withCrossTenantAdmin;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;

const TEST_SECRET = "whsec_test_secret";

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  process.env["STRIPE_WEBHOOK_SECRET"] = TEST_SECRET;
  ({ withCrossTenantAdmin } = await import("@/lib/tenant/cron"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq } = await import("drizzle-orm"));

  // Ensure workspace_billing row exists for the test workspace.
  await withCrossTenantAdmin("billing.test-seed", async (tx) => {
    await tx
      .insert(schema.workspaceBilling)
      .values({ workspaceId: wsA.id, plan: "free" })
      .onConflictDoNothing();
  });
}, 60_000);

afterAll(() => teardownTestWorkspaces());

function makeStripeRequest(
  workspaceId: string,
  eventType: string,
  eventId: string,
  extra: Record<string, unknown> = {}
): Request {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    id: eventId,
    type: eventType,
    data: {
      object: {
        metadata: { workspaceId },
        customer: "cus_test",
        ...extra,
      },
    },
  });
  const sig = crypto.createHmac("sha256", TEST_SECRET).update(`${ts}.${body}`).digest("hex");
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${ts},v1=${sig}` },
    body,
  });
}

it("deduplicates repeated Stripe event delivery", async () => {
  const { POST } = await import("@/app/api/billing/webhook/route");
  const evtId = `evt_dedup_${Date.now()}`;

  const res1 = await POST(makeStripeRequest(wsA.id, "customer.subscription.updated", evtId));
  const body1 = await res1.json();
  expect(res1.status).toBe(200);
  expect(body1.deduped).toBeUndefined();

  // Second delivery of the same event must short-circuit.
  const res2 = await POST(makeStripeRequest(wsA.id, "customer.subscription.updated", evtId));
  const body2 = await res2.json();
  expect(res2.status).toBe(200);
  expect(body2.deduped).toBe(true);
});

it("sets past_due=true on invoice.payment_failed", async () => {
  const { POST } = await import("@/app/api/billing/webhook/route");
  const evtId = `evt_pf_${Date.now()}`;

  const res = await POST(makeStripeRequest(wsA.id, "invoice.payment_failed", evtId));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.ok).toBe(true);

  const db = getDb();
  const rows = await db
    .select({ pastDue: schema.workspaceBilling.pastDue })
    .from(schema.workspaceBilling)
    .where(eq(schema.workspaceBilling.workspaceId, wsA.id));
  expect(rows[0]?.pastDue).toBe(true);
});
