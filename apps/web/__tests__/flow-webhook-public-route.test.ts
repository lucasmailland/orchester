import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { signFlowWebhook } from "@/lib/flows/webhook-signature";

const h = vi.hoisted(() => ({ hmacKey: "test-key" as string | null, enqueued: 0 }));

vi.mock("@orchester/db", () => ({
  schema: { flowWebhooks: { secret: "w.secret", id: "w.id" } },
}));
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/flow-engine", () => ({
  enqueueFlowRun: async () => {
    h.enqueued += 1;
    return { runId: "r1" };
  },
}));
vi.mock("@/lib/tenant/cron", () => ({
  withCrossTenantAdmin: async (_n: string, fn: (t: unknown) => unknown) =>
    fn({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              { id: "wh_1", flowId: "f1", workspaceId: "ws_1", enabled: true, hmacKey: h.hmacKey },
            ],
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    }),
}));

const URL_ = "https://x.test/api/webhooks/s?x=1";
const BODY = '{"a":1}';
const ctx = { params: Promise.resolve({ secret: "s" }) };
const NOW = new Date("2026-11-23T12:00:00Z");
const sec = () => Math.floor(Date.now() / 1000);

async function post(sig?: string) {
  const { POST } = await import("@/app/api/webhooks/[secret]/route");
  return POST(
    new Request(URL_, {
      method: "POST",
      body: BODY,
      headers: sig ? { "x-orchester-signature": sig } : {},
    }),
    ctx
  );
}

beforeEach(() => {
  h.hmacKey = "test-key";
  h.enqueued = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("public flow webhook route", () => {
  it("answers 405 to GET unless FLOW_WEBHOOK_ALLOW_GET=1", async () => {
    const { GET } = await import("@/app/api/webhooks/[secret]/route");
    h.hmacKey = null;
    expect((await GET(new Request(URL_), ctx)).status).toBe(405);
    vi.stubEnv("FLOW_WEBHOOK_ALLOW_GET", "1");
    expect((await GET(new Request(URL_), ctx)).status).toBe(202);
  });

  it("accepts a timely signed POST", async () => {
    expect((await post(signFlowWebhook("test-key", "?x=1", BODY, sec()))).status).toBe(202);
  });

  it("rejects the same request 301 s later", async () => {
    const sig = signFlowWebhook("test-key", "?x=1", BODY, sec());
    vi.setSystemTime(new Date(NOW.getTime() + 301_000));
    expect((await post(sig)).status).toBe(401);
    expect(h.enqueued).toBe(0);
  });

  it("rejects the legacy signature unless FLOW_WEBHOOK_LEGACY_SIGNATURE=1", async () => {
    const old = crypto.createHmac("sha256", "test-key").update(BODY).digest("hex");
    expect((await post(old)).status).toBe(401);
    vi.stubEnv("FLOW_WEBHOOK_LEGACY_SIGNATURE", "1");
    expect((await post(old)).status).toBe(202);
  });

  it("still accepts an unsigned POST when the webhook has no hmacKey", async () => {
    h.hmacKey = null;
    expect((await post()).status).toBe(202);
  });
});
