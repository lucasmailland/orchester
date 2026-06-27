// apps/web/tests/unit/stripe-webhook-fail-closed.spec.ts
//
// SEC-5: when STRIPE_WEBHOOK_SECRET is unset the webhook must refuse (501),
// not silently process any POST as a valid subscription event.
import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";

describe("SEC-5 — Stripe webhook fails closed without secret", () => {
  it("route returns 501 (not implemented) when STRIPE_WEBHOOK_SECRET is absent", async () => {
    const saved = process.env["STRIPE_WEBHOOK_SECRET"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];

    vi.resetModules();
    const { POST } = await import("@/app/api/billing/webhook/route");
    const req = new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      body: JSON.stringify({ type: "checkout.session.completed", data: { object: {} } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(501);

    if (saved !== undefined) process.env["STRIPE_WEBHOOK_SECRET"] = saved;
  });

  it("route source does not contain a bare `if (secret)` open-pass pattern", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../app/api/billing/webhook/route.ts"),
      "utf8"
    );
    // Must NOT have the pattern where missing secret falls through to processing.
    // The guard should be: if (!secret) return 501 BEFORE reading the body.
    expect(src).not.toMatch(/if \(secret\) \{[\s\S]*?\}/);
    expect(src).toMatch(/501/);
  });
});
