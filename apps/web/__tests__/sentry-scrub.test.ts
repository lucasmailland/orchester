import { describe, expect, it } from "vitest";
import { redactUrl } from "../lib/secret-patterns";
import { scrubSentryEvent } from "../lib/sentry-scrub";

describe("redactUrl", () => {
  it("redacts the segment after /webhook/", () => {
    expect(redactUrl("https://x/api/channels/slack/webhook/abc123?x=1")).toBe(
      "https://x/api/channels/slack/webhook/[redacted]?x=1"
    );
  });
  it("redacts secret query params", () => {
    const out = redactUrl("https://x/es/deleted/ws1?token=rst_abc&code=zzz&ok=1");
    expect(out).not.toContain("rst_abc");
    expect(out).not.toContain("zzz");
    expect(out).toContain("ok=1");
  });
});

describe("scrubSentryEvent", () => {
  it("drops cookies, auth headers and url tokens", () => {
    const ev = scrubSentryEvent({
      request: {
        url: "https://x/api/exports/tok123",
        query_string: "signature=sig999&a=1",
        cookies: { s: "cookieval" },
        headers: {
          Cookie: "sid=cookieval",
          authorization: "Bearer abc",
          "X-Orchester-Signature": "sig999",
        },
      },
    });
    const json = JSON.stringify(ev);
    for (const leak of ["tok123", "cookieval", "sig999", "Bearer abc"])
      expect(json).not.toContain(leak);
  });
  it("redacts secret-shaped text in message and exceptions", () => {
    const key = "sk-ant-api03-" + "x".repeat(24);
    const ev = scrubSentryEvent({
      message: `failed with ${key}`,
      exception: { values: [{ value: key }] },
    });
    expect(JSON.stringify(ev)).not.toContain(key);
  });
});
