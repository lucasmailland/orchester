import { describe, it, expect, afterEach, vi } from "vitest";
import { getConnector } from "@/lib/integrations/registry";

const CONFIG = { webhookUrl: "https://discord.com/api/webhooks/123/abc" };
function mockDiscord(body: string | null = null, status = 204) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(body, { status });
    })
  );
  return calls;
}
async function run(action: string, input: Record<string, unknown>, config = CONFIG) {
  expect(getConnector("discord")).toBeDefined();
  return getConnector("discord")!.actions[action]!.run(config, input);
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("discord connector", () => {
  it("registers secret credentials and two messaging actions", () => {
    const connector = getConnector("discord");
    expect(connector).toBeDefined();
    expect(connector!.category).toBe("messaging");
    expect(connector!.fields).toEqual([
      expect.objectContaining({ key: "webhookUrl", type: "password", required: true }),
    ]);
    expect(Object.keys(connector!.actions).sort()).toEqual(["send_embed", "send_message"]);
  });
  it("posts a message with an encoded thread ID and handles an empty 204", async () => {
    const calls = mockDiscord();
    expect(
      await run("send_message", { content: "Hello", username: "Test bot", threadId: "123 & 456" })
    ).toEqual({ ok: true, status: 204 });
    expect(calls[0]!.url).toBe(`${CONFIG.webhookUrl}?thread_id=123+%26+456`);
    expect(calls[0]!.init).toMatchObject({
      method: "POST",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(new Headers(calls[0]!.init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      content: "Hello",
      username: "Test bot",
    });
  });
  it("maps only the supported fields onto a single embed", async () => {
    const calls = mockDiscord();
    const embed = {
      title: "Title",
      description: "Details",
      url: "https://example.com",
      color: 255,
      fields: [{ name: "State", value: "Ready", inline: true }],
    };
    await run("send_embed", { ...embed, method: "DELETE", image: { url: "https://example.com" } });
    expect(calls[0]!.url).toBe(CONFIG.webhookUrl);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ embeds: [embed] });
  });
  it.each([1999, 2000, 2001])("handles message length %s", async (length) => {
    const calls = mockDiscord();
    await run("send_message", { content: "x".repeat(length) });
    expect(JSON.parse(String(calls[0]!.init.body)).content).toBe(
      length > 2000 ? "x".repeat(1999) + "…" : "x".repeat(length)
    );
  });
  it.each([
    "https://example.com/api/webhooks/123/abc",
    "https://discord.com.example.com/api/webhooks/123/abc",
    "http://discord.com/api/webhooks/123/abc",
    "https://discord.com@ example.com/api/webhooks/123/abc",
    "https://discord.com/api/webhooks/123/abc/other",
    "https://discord.com:444/api/webhooks/123/abc",
    "https://discord.com/api/webhooks/123/abc?redirect=example.com",
    "not a URL",
  ])("rejects an unsafe webhook URL before fetching: %s", async (webhookUrl) => {
    const calls = mockDiscord();
    await expect(run("send_message", { content: "Hello" }, { webhookUrl })).rejects.toThrow(
      /Discord webhook URL/
    );
    expect(calls).toHaveLength(0);
  });
  it("tests URL format locally without posting a message", async () => {
    const calls = mockDiscord();
    expect(getConnector("discord")).toBeDefined();
    expect(await getConnector("discord")!.test(CONFIG)).toMatchObject({
      ok: true,
      meta: { validation: "URL format only" },
    });
    expect((await getConnector("discord")!.test({ webhookUrl: "https://example.com" })).ok).toBe(
      false
    );
    expect(calls).toHaveLength(0);
  });
  it("scrubs the webhook and token before trimming provider errors", async () => {
    mockDiscord(`  Denied ${CONFIG.webhookUrl} abc ${"x".repeat(500)}  `, 403);
    const error = (await run("send_message", { content: "Hello" }).catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/^Discord HTTP 403: Denied/);
    expect(error.message).not.toContain(CONFIG.webhookUrl);
    expect(error.message).not.toContain("abc");
    expect(error.message.length).toBeLessThan(240);
  });
  it("scrubs transport errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`Failed ${CONFIG.webhookUrl}`)));
    const error = (await run("send_embed", { title: "Title", description: "Details" }).catch(
      (e: Error) => e
    )) as Error;
    expect(error.message).not.toContain("abc");
  });
});
