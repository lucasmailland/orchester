import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { checkFlowWebhookSignature, signFlowWebhook } from "@/lib/flows/webhook-signature";

const key = "test-key";
const now = 1_700_000_000;
const body = '{"a":1}';
const search = "?x=1";

describe("checkFlowWebhookSignature", () => {
  it("accepts a fresh signature", () => {
    const h = signFlowWebhook(key, search, body, now);
    expect(checkFlowWebhookSignature(key, h, search, body, now)).toBe("ok");
  });
  it("rejects one older than 300 s", () => {
    const h = signFlowWebhook(key, search, body, now - 301);
    expect(checkFlowWebhookSignature(key, h, search, body, now)).toBe("stale");
  });
  it("rejects a changed body or query string", () => {
    const h = signFlowWebhook(key, search, body, now);
    expect(checkFlowWebhookSignature(key, h, search, '{"a":2}', now)).toBe("mismatch");
    expect(checkFlowWebhookSignature(key, h, "?x=2", body, now)).toBe("mismatch");
  });
  it("reports the old body-only hex as legacy", () => {
    const old = crypto.createHmac("sha256", key).update(body).digest("hex");
    expect(checkFlowWebhookSignature(key, old, search, body, now)).toBe("legacy");
  });
  it("reports missing and malformed headers", () => {
    expect(checkFlowWebhookSignature(key, null, search, body, now)).toBe("missing");
    expect(checkFlowWebhookSignature(key, "t=abc,v1=" + "0".repeat(64), search, body, now)).toBe(
      "malformed"
    );
  });
});
