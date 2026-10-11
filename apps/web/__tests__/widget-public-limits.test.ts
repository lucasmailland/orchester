import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  channel: undefined as Record<string, unknown> | undefined,
  handleInbound: vi.fn(),
  handleInboundStream: vi.fn(),
}));
vi.mock("@/lib/tenant/cron", () => ({
  withCrossTenantAdmin: async () => mocks.channel,
}));
vi.mock("@/lib/channels/router", () => ({
  handleInbound: mocks.handleInbound,
  handleInboundStream: mocks.handleInboundStream,
}));

const { WIDGET_LIMITS, WIDGET_MAX_TEXT_CHARS } = await import("@/lib/channels/widget-guard");
const messages = await import("@/app/api/widget/[channelId]/messages/route");
const stream = await import("@/app/api/widget/[channelId]/stream/route");

let seq = 0;
/** Rate-limit buckets live in process memory: a fresh channel id per test keeps them apart. */
function useChannel(overrides: Record<string, unknown> = {}): string {
  const id = `ch_widget_${++seq}`;
  mocks.channel = { id, workspaceId: "ws_test", type: "widget", status: "active", ...overrides };
  return id;
}

function call(
  route: typeof messages | typeof stream,
  channelId: string,
  body: Record<string, unknown>,
  ip = "203.0.113.7"
): Promise<Response> {
  return route.POST(
    new Request(`https://example.com/api/widget/${channelId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ channelId }) }
  );
}

const MESSAGE = { visitorId: "v_1", text: "hola" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handleInbound.mockResolvedValue({ conversationId: "conv_1", reply: "hi" });
  mocks.handleInboundStream.mockImplementation(async function* () {
    yield { type: "done", conversationId: "conv_1", reply: "hi", tokensUsed: 1 };
  });
});

describe.each([
  ["messages", messages, () => mocks.handleInbound],
  ["stream", stream, () => mocks.handleInboundStream],
] as const)("POST /api/widget/[channelId]/%s", (_name, route, handler) => {
  it("stops one visitor address after its per-minute budget", async () => {
    const channelId = useChannel();
    const budget = WIDGET_LIMITS.perClient.capacity;
    for (let i = 0; i < budget; i++) {
      expect((await call(route, channelId, MESSAGE)).status).not.toBe(429);
    }
    const limited = await call(route, channelId, MESSAGE);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("access-control-allow-origin")).toBe("*");
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(handler()).toHaveBeenCalledTimes(budget);
  });

  it("caps the whole channel even when every request comes from a new address", async () => {
    // The client address comes from X-Forwarded-For, which a caller can forge.
    // The per-channel bucket is the limit that cannot be dodged that way.
    const channelId = useChannel();
    const budget = WIDGET_LIMITS.perChannel.capacity;
    for (let i = 0; i < budget; i++) {
      await call(route, channelId, MESSAGE, `198.51.100.${i}`);
    }
    expect((await call(route, channelId, MESSAGE, "192.0.2.200")).status).toBe(429);
    expect(handler()).toHaveBeenCalledTimes(budget);
  });

  it("refuses text longer than the widget allows, without reaching the agent", async () => {
    const channelId = useChannel();
    const res = await call(route, channelId, {
      visitorId: "v_1",
      text: "x".repeat(WIDGET_MAX_TEXT_CHARS + 1),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(handler()).not.toHaveBeenCalled();
  });

  it("requires visitorId and text", async () => {
    const channelId = useChannel();
    expect((await call(route, channelId, { text: "hola" })).status).toBe(400);
    expect((await call(route, channelId, { visitorId: "v_1", text: "   " })).status).toBe(400);
    expect(handler()).not.toHaveBeenCalled();
  });

  it("answers 404 for an inactive channel", async () => {
    const channelId = useChannel({ status: "inactive" });
    expect((await call(route, channelId, MESSAGE)).status).toBe(404);
    expect(handler()).not.toHaveBeenCalled();
  });

  it("answers 404 for a channel that is not a widget", async () => {
    const channelId = useChannel({ type: "telegram" });
    expect((await call(route, channelId, MESSAGE)).status).toBe(404);
  });
});

describe("POST /api/widget/[channelId]/messages errors", () => {
  it("does not show internal error messages to the visitor", async () => {
    const channelId = useChannel();
    mocks.handleInbound.mockRejectedValue(new Error("relation agent_x does not exist"));
    const res = await call(messages, channelId, MESSAGE);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("agent_x");
  });
});
