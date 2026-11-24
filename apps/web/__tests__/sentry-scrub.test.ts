import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { redactUrl } from "../lib/secret-patterns";
import { SECRET_HEADERS, scrubBreadcrumb, scrubSentryEvent } from "../lib/sentry-scrub";

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

describe("scrubSentryEvent round 2", () => {
  it("redacts secret-named keys anywhere in the tree", () => {
    const ev = scrubSentryEvent({
      contexts: { response: { headers: { "Set-Cookie": "sess=zz1" } } },
      extra: { a: { authorization: "Bearer zz2" } },
    });
    expect(JSON.stringify(ev)).not.toMatch(/zz1|zz2/);
  });
  it("drops the Referer header key", () => {
    const ev = scrubSentryEvent({ request: { headers: { Referer: "https://x/p?a=1", ok: "1" } } });
    expect(ev.request.headers).toEqual({ ok: "1" });
  });
  it("redacts percent-encoded tokens", () => {
    const ev = scrubSentryEvent({
      extra: { a: "/api/exports%2Fenc1", b: "/p?access%5Ftoken=enc2" },
    });
    expect(JSON.stringify(ev)).not.toMatch(/enc1|enc2/);
  });
});

describe("Caddyfile / SECRET_HEADERS sync", () => {
  const caddy = readFileSync(resolve(__dirname, "../../../deploy/Caddyfile"), "utf8");
  const deletes = [...caddy.matchAll(/request>headers>([A-Za-z0-9-]+)\s+delete/g)].map((m) =>
    m[1]!.toLowerCase()
  );
  // set-cookie is a response header (Caddy: resp_headers); referrer is only a Sentry-side alias.
  const sentryOnly = new Set(["set-cookie", "referrer"]);
  it("every Caddy request-header delete is in SECRET_HEADERS", () => {
    for (const h of deletes) expect(SECRET_HEADERS.has(h)).toBe(true);
  });
  it("every SECRET_HEADERS entry has a Caddy delete", () => {
    for (const h of SECRET_HEADERS) if (!sentryOnly.has(h)) expect(deletes).toContain(h);
  });
});

describe("scrub performance (ReDoS)", () => {
  const timed = (s: string) => {
    const t = performance.now();
    scrubSentryEvent({ request: { url: s }, transaction: s });
    return performance.now() - t;
  };
  it.each([
    ["?key repeated", "?key".repeat(5000)],
    ["a?b= repeated (100 KB)", "a?b=".repeat(25_000)],
    ["eyJ repeated", "eyJ".repeat(6000)],
    ["postgres:// repeated", "postgres://a:".repeat(1500)],
  ])("scrubs %s in < 200 ms", (_name, s) => {
    expect(timed(s)).toBeLessThan(200);
  });
  it("truncates very long strings", () => {
    const ev = scrubSentryEvent({ extra: { s: "x".repeat(20_000) } });
    const s = (ev.extra as { s: string }).s;
    expect(s.length).toBeLessThan(17_000);
    expect(s.endsWith("…[truncated]")).toBe(true);
  });
  it("still redacts a JWT after a delimiter", () => {
    expect(scrubSentryEvent({ message: "jwt=eyJhbGc.eyJzdWI.c2ln" }).message).toBe(
      "jwt=eyJ***REDACTED***"
    );
  });
  it("keeps the redaction when a secret param follows a value with ?", () => {
    expect(redactUrl("https://x/p?next=/a?token=t9&ok=1")).not.toContain("t9");
  });
});

describe("stack frames keep their paths", () => {
  it("does not rewrite filename, abs_path, module or function", () => {
    const frame = {
      filename: "app:///api/webhooks/[secret]/route.js",
      abs_path: "/srv/app/.next/server/app/api/webhooks/[secret]/route.js",
      module: "app/api/webhooks/[secret]/route",
      function: "POST /api/webhooks/[secret]",
      vars: { url: "https://x/api/webhooks/tok7" },
    };
    const ev = scrubSentryEvent({
      exception: { values: [{ stacktrace: { frames: [{ ...frame }] } }] },
    });
    const out = ev.exception.values[0]!.stacktrace.frames[0]!;
    expect(out.filename).toBe(frame.filename);
    expect(out.abs_path).toBe(frame.abs_path);
    expect(out.module).toBe(frame.module);
    expect(out.function).toBe(frame.function);
    expect(JSON.stringify(out.vars)).not.toContain("tok7");
  });
});
