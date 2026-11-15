// apps/web/tests/integration/security/widget-rate-limit.spec.ts
//
// SEC-8: verify the public widget POST /messages endpoint is rate-limited.
// Mock handleInbound + withCrossTenantAdmin so no real DB or LLM call is
// needed. Hammer the route past the 60-token bucket and confirm a 429 appears.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

vi.mock("@/lib/channels/router", () => ({
  handleInbound: vi.fn().mockResolvedValue({ conversationId: "c1", reply: "hi" }),
}));

vi.mock("@/lib/tenant/cron", () => ({
  withCrossTenantAdmin: vi.fn(async (_reason: string, fn: (tx: unknown) => unknown) =>
    fn({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => [{ id: "chan-rl", workspaceId: "ws-A", type: "widget" }],
          }),
        }),
      }),
    })
  ),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { "content-type": "application/json" },
      }),
  },
}));

beforeEach(() => vi.clearAllMocks());

describe("SEC-8: widget messages endpoint is rate-limited", () => {
  it("returns 429 once the per-channel bucket is exhausted", async () => {
    const { POST } = await import("@/app/api/widget/[channelId]/messages/route");
    const mk = () =>
      POST(
        new Request("http://x", {
          method: "POST",
          body: JSON.stringify({ visitorId: "v", text: "hi" }),
        }),
        { params: Promise.resolve({ channelId: "chan-rl" }) }
      );
    let saw429 = false;
    for (let i = 0; i < 80; i++) {
      const res = await mk();
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
