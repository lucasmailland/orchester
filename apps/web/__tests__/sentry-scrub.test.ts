import { describe, expect, it } from "vitest";
import { redactUrl } from "../lib/secret-patterns";
import { scrubBreadcrumb, scrubSentryEvent } from "../lib/sentry-scrub";

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
  it("redacts object and tuple-array query_string keeping their shape", () => {
    const o = scrubSentryEvent({ request: { query_string: { token: "abc", a: "1" } } });
    expect(o.request?.query_string).toEqual({ token: "[redacted]", a: "1" });
    const t = scrubSentryEvent({
      request: {
        query_string: [
          ["token", "abc"],
          ["a", "1"],
        ],
      },
    });
    expect(t.request?.query_string).toEqual([
      ["token", "[redacted]"],
      ["a", "1"],
    ]);
  });
  it("redacts tokenised span urls in transactions", () => {
    const ev = scrubSentryEvent({
      transaction: "GET /api/exports/tok1",
      spans: [
        {
          description: "GET https://x/api/exports/tok2",
          data: { "http.url": "https://x/api/invite/tok3?code=c4" },
        },
      ],
    });
    const json = JSON.stringify(ev);
    for (const leak of ["tok1", "tok2", "tok3", "c4"]) expect(json).not.toContain(leak);
  });
  it("redacts the Referer header", () => {
    const ev = scrubSentryEvent({
      request: { headers: { Referer: "https://x/p?token=refsecret&a=1" } },
    });
    expect(JSON.stringify(ev)).not.toContain("refsecret");
  });
  it("scrubs breadcrumb messages and urls", () => {
    const c = scrubBreadcrumb({
      message: "GET https://x/api/exports/bc1",
      data: { url: "https://x/approve/bc2" },
    });
    expect(JSON.stringify(c)).not.toMatch(/bc1|bc2/);
  });
  it("redacts nested extra, breadcrumb data and surviving header values", () => {
    const key = "sk-ant-api03-" + "y".repeat(24);
    const ev = scrubSentryEvent({
      extra: { deep: { url: "https://x/api/exports/nest1", note: key } },
      breadcrumbs: [{ message: "m", data: { a: { b: "https://x/p?access_token=bc9" } } }],
      request: { headers: { "X-Api-Key": "apik", "Set-Cookie": "s=1", "x-other": `v ${key}` } },
    });
    const json = JSON.stringify(ev);
    for (const leak of ["nest1", key, "bc9", "apik", "s=1"]) expect(json).not.toContain(leak);
    expect(
      JSON.stringify(scrubBreadcrumb({ data: { n: { u: "https://x/p?api_key=bk1" } } }))
    ).not.toContain("bk1");
  });
  it("redacts param names containing secret words, any case", () => {
    const out = redactUrl("https://x/p?access_token=a1&api_key=b2&Token=c3&page=2");
    for (const leak of ["a1", "b2", "c3"]) expect(out).not.toContain(leak);
    expect(out).toContain("page=2");
  });
  it("survives cycles and very deep objects", () => {
    const a: Record<string, unknown> = { s: "https://x/exports/cyc1" };
    a["self"] = a;
    let deep: Record<string, unknown> = { s: "https://x/exports/deep1" };
    for (let i = 0; i < 30; i++) deep = { n: deep };
    const ev = scrubSentryEvent({ extra: { a, deep } });
    expect(JSON.stringify(ev)).not.toMatch(/cyc1|deep1/);
  });
});
