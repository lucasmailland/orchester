import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ withCrossTenantAdmin: vi.fn() }));
vi.mock("@/lib/tenant/cron", () => ({ withCrossTenantAdmin: mocks.withCrossTenantAdmin }));

const { checkStripeSignature } = await import("@/lib/billing/stripe-signature");
const { POST } = await import("@/app/api/billing/webhook/route");

const SECRET = "whsec_test_secret";
const NOW = 1_800_000_000;

function sign(raw: string, t: number, secret = SECRET): string {
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

const EVENT = JSON.stringify({
  type: "customer.subscription.deleted",
  data: { object: { metadata: { workspaceId: "ws_test" } } },
});

describe("checkStripeSignature", () => {
  it("accepts a signature made with the configured secret", () => {
    expect(checkStripeSignature(SECRET, sign(EVENT, NOW), EVENT, NOW)).toBe("ok");
  });

  it.each([undefined, ""])("reports %j as unconfigured, never as ok", (secret) => {
    // Without a secret nothing can be verified. The caller must refuse the
    // event; a boolean here would make "not configured" read as "verified".
    expect(checkStripeSignature(secret, sign(EVENT, NOW), EVENT, NOW)).toBe("unconfigured");
    expect(checkStripeSignature(secret, null, EVENT, NOW)).toBe("unconfigured");
  });

  it("reports a missing header", () => {
    expect(checkStripeSignature(SECRET, null, EVENT, NOW)).toBe("missing");
    expect(checkStripeSignature(SECRET, "", EVENT, NOW)).toBe("missing");
  });

  it("refuses a timestamp outside the tolerance window", () => {
    expect(checkStripeSignature(SECRET, sign(EVENT, NOW - 301), EVENT, NOW)).toBe("stale");
    expect(checkStripeSignature(SECRET, sign(EVENT, NOW + 301), EVENT, NOW)).toBe("stale");
  });

  it.each([
    ["another secret", sign(EVENT, NOW, "whsec_other")],
    ["a tampered body", sign(`${EVENT} `, NOW)],
    ["no v1 entry", `t=${NOW}`],
    ["a v1 that is not hex", `t=${NOW},v1=zz`],
  ])("refuses %s", (_case, header) => {
    expect(checkStripeSignature(SECRET, header, EVENT, NOW)).toBe("invalid");
  });

  it("accepts any of several v1 entries, as Stripe sends during secret rolls", () => {
    const good = sign(EVENT, NOW).split(",")[1];
    const header = `t=${NOW},v1=${"0".repeat(64)},${good}`;
    expect(checkStripeSignature(SECRET, header, EVENT, NOW)).toBe("ok");
  });
});

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  function post(raw: string, signature?: string): Promise<Response> {
    return POST(
      new Request("https://example.com/api/billing/webhook", {
        method: "POST",
        headers: signature ? { "stripe-signature": signature } : {},
        body: raw,
      })
    );
  }

  it("refuses every event when no webhook secret is configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const res = await post(EVENT);
    expect(res.status).toBe(503);
    expect(mocks.withCrossTenantAdmin).not.toHaveBeenCalled();
  });

  it("refuses an unsigned event when a secret is configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    expect((await post(EVENT)).status).toBe(400);
    expect(mocks.withCrossTenantAdmin).not.toHaveBeenCalled();
  });

  it("refuses a badly signed event", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    expect((await post(EVENT, sign(EVENT, NOW, "whsec_other"))).status).toBe(401);
    expect(mocks.withCrossTenantAdmin).not.toHaveBeenCalled();
  });

  it("processes a correctly signed event", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    const res = await post(EVENT, sign(EVENT, NOW));
    expect(res.status).toBe(200);
    expect(mocks.withCrossTenantAdmin).toHaveBeenCalledTimes(1);
  });

  it("answers 400 to a signed body that is not JSON", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    const raw = "not json";
    expect((await post(raw, sign(raw, NOW))).status).toBe(400);
  });
});
