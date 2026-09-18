import { describe, it, expect, afterEach, vi } from "vitest";
import { getConnector } from "@/lib/integrations/registry";

const CONFIG = { botToken: "test-token", defaultChatId: "1234567" };
function mockTelegram(payload: unknown = { ok: true, result: {} }, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
        status,
      });
    })
  );
  return calls;
}
async function run(input: Record<string, unknown>, config = CONFIG) {
  expect(getConnector("telegram")).toBeDefined();
  return getConnector("telegram")!.actions.send_message!.run(config, input);
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("telegram connector", () => {
  it("registers credentials and a single messaging action", () => {
    const connector = getConnector("telegram");
    expect(connector).toBeDefined();
    expect(connector!.category).toBe("messaging");
    expect(connector!.fields).toEqual([
      expect.objectContaining({ key: "botToken", type: "password", required: true }),
      expect.objectContaining({ key: "defaultChatId", type: "text", required: true }),
    ]);
    expect(Object.keys(connector!.actions)).toEqual(["send_message"]);
  });
  it.each(["MarkdownV2", "HTML"])(
    "posts with chat override and %s formatting",
    async (parseMode) => {
      const calls = mockTelegram();
      expect(
        await run({ text: "Hello", chatId: "-1234567", parseMode, disableNotification: true })
      ).toEqual({ ok: true, status: 200 });
      expect(calls[0]!.url).toBe("https://api.telegram.org/bottest-token/sendMessage");
      expect(calls[0]!.init).toMatchObject({
        method: "POST",
        redirect: "error",
        signal: expect.any(AbortSignal),
      });
      expect(new Headers(calls[0]!.init.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
        chat_id: "-1234567",
        text: "Hello",
        parse_mode: parseMode,
        disable_notification: true,
      });
    }
  );
  it.each([undefined, "none"])(
    "defaults the chat and omits formatting for %s",
    async (parseMode) => {
      const calls = mockTelegram();
      await run({ text: "Hello", parseMode, disableNotification: false });
      expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
        chat_id: CONFIG.defaultChatId,
        text: "Hello",
        disable_notification: false,
      });
    }
  );
  it.each([4095, 4096, 4097])("handles text length %s", async (length) => {
    const calls = mockTelegram();
    await run({ text: "x".repeat(length) });
    expect(JSON.parse(String(calls[0]!.init.body)).text).toBe(
      length > 4096 ? "x".repeat(4095) + "…" : "x".repeat(length)
    );
  });
  it("tests credentials via POST getMe without returning provider data", async () => {
    const calls = mockTelegram({ ok: true, result: { first_name: CONFIG.botToken } });
    expect(getConnector("telegram")).toBeDefined();
    expect(await getConnector("telegram")!.test(CONFIG)).toEqual({ ok: true });
    expect(calls[0]!.url).toBe("https://api.telegram.org/bottest-token/getMe");
    expect(calls[0]!.init.method).toBe("POST");
  });
  it.each([200, 401])("scrubs token from API errors with HTTP %s", async (status) => {
    mockTelegram(
      { ok: false, description: `Denied ${CONFIG.botToken} ${"x".repeat(500)}` },
      status
    );
    const error = (await run({ text: "Hello" }).catch((e: Error) => e)) as Error;
    expect(error.message).toContain("Denied");
    expect(error.message).not.toContain(CONFIG.botToken);
    expect(error.message.length).toBeLessThan(240);
  });
  it("scrubs fetch failures, including URL paths, from errors and test results", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new Error(`Failed https://api.telegram.org/bot${CONFIG.botToken}/sendMessage`)
        )
    );
    const error = (await run({ text: "Hello" }).catch((e: Error) => e)) as Error;
    expect(error.message).not.toContain(CONFIG.botToken);
    const result = await getConnector("telegram")!.test(CONFIG);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(CONFIG.botToken);
  });
  it("does not echo provider success data", async () => {
    mockTelegram({ ok: true, result: { text: CONFIG.botToken } });
    expect(await run({ text: "Hello" })).toEqual({ ok: true, status: 200 });
  });
  it("scrubs malformed JSON errors", async () => {
    mockTelegram(`  ${CONFIG.botToken} invalid JSON  `);
    const error = (await run({ text: "Hello" }).catch((e: Error) => e)) as Error;
    expect(error.message).toContain("non-JSON");
    expect(error.message).not.toContain(CONFIG.botToken);
  });
  it.each([
    { text: "" },
    { text: "Hello", parseMode: "Markdown" },
    { text: "Hello", disableNotification: "false" },
  ])("rejects invalid input", async (input) => {
    const calls = mockTelegram();
    await expect(run(input)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
