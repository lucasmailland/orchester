import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@orchester/db", () => ({
  schema: { channels: { id: "id", workspaceId: "w", type: "type", status: "status" } },
}));
vi.mock("@/lib/encryption", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.slice(4),
}));
vi.mock("@/lib/http-util", () => ({ fetchWithTimeout: vi.fn() }));

const telegram = await import("@/lib/channels/telegram");

// The helper calls the module's own exports, so stub the network at fetch level.
const fetchMock = vi.fn();
vi.mocked((await import("@/lib/http-util")).fetchWithTimeout).mockImplementation(fetchMock);

type Row = { id: string; workspaceId: string; secret: string; credentialsEncrypted: string };
/** Each call of the returned `withTx` is its own transaction; `failWriteFor` makes one write throw. */
function fakeDb(rows: Row[], failWriteFor: string[] = []) {
  const writes: { credentialsEncrypted: string }[] = [];
  let transactions = 0;
  const withTx = async <T>(fn: (tx: never) => Promise<T>): Promise<T> => {
    transactions++;
    const tx = {
      select: () => ({ from: () => ({ where: async () => rows }) }),
      update: () => ({
        set: (v: { credentialsEncrypted: string }) => ({
          where: async () => {
            const n = writes.length + failedCount;
            if (failWriteFor.includes(String(n))) {
              failedCount++;
              throw new Error("db down");
            }
            writes.push({ credentialsEncrypted: v.credentialsEncrypted });
          },
        }),
      }),
    };
    return fn(tx as never);
  };
  let failedCount = 0;
  return { withTx, writes, transactions: () => transactions };
}
const enc = (o: object) => `enc:${JSON.stringify(o)}`;
const unsigned = (id: string): Row => ({
  id,
  workspaceId: "w",
  secret: `s-${id}`,
  credentialsEncrypted: enc({ botToken: `t-${id}` }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
  fetchMock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ ok: true, result: { username: "test_bot" } }),
    text: async () => "",
  }));
});

it("registers a secret on a channel without one and leaves a signed one alone", async () => {
  const signed: Row = {
    id: "c2",
    workspaceId: "w",
    secret: "s2",
    credentialsEncrypted: enc({ botToken: "t2", webhookSecret: "a".repeat(48) }),
  };
  const db = fakeDb([unsigned("c1"), signed]);
  const result = await telegram.registerMissingTelegramSecrets(db.withTx);
  expect(result).toEqual({ updated: ["c1"], skipped: [], failed: [] });
  expect(db.writes).toHaveLength(1);
  const creds = telegram.decodeTelegramCredentials(db.writes[0]!.credentialsEncrypted);
  expect(creds?.botToken).toBe("t-c1");
  expect(creds?.webhookSecret).toMatch(/^[0-9a-f]{48}$/);
  // Telegram got the channel URL and the very secret that was stored.
  const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/setWebhook"))!;
  const sent = JSON.parse(call[1].body);
  expect(sent.url).toBe("https://example.com/api/channels/telegram/webhook/s-c1");
  expect(sent.secret_token).toBe(creds?.webhookSecret);
});

it("keeps the stored credentials when setWebhook fails", async () => {
  fetchMock.mockImplementation(async (url: string) =>
    String(url).endsWith("/setWebhook")
      ? { ok: false, status: 500, text: async () => "boom" }
      : { ok: true, json: async () => ({ ok: true }) }
  );
  const db = fakeDb([unsigned("c1")]);
  const result = await telegram.registerMissingTelegramSecrets(db.withTx);
  expect(result).toEqual({
    updated: [],
    skipped: [],
    failed: [{ id: "c1", reason: "set_webhook_failed" }],
  });
  expect(db.writes).toHaveLength(0);
});

it("commits each channel in its own transaction: a later write failing keeps the earlier one", async () => {
  // Writes are numbered; the second attempt (index 1) throws.
  const db = fakeDb([unsigned("c1"), unsigned("c2")], ["1"]);
  const result = await telegram.registerMissingTelegramSecrets(db.withTx);
  expect(result).toEqual({
    updated: ["c1"],
    skipped: [],
    failed: [{ id: "c2", reason: "write_failed" }],
  });
  expect(db.writes).toHaveLength(1);
  // select + one transaction per channel.
  expect(db.transactions()).toBe(3);
});

it("reports channels it cannot attempt as skipped, and a bad token as invalid_token", async () => {
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ ok: false }) }));
  const broken: Row = { ...unsigned("c1"), credentialsEncrypted: "enc:not-json" };
  const db = fakeDb([broken, unsigned("c2")]);
  const result = await telegram.registerMissingTelegramSecrets(db.withTx);
  expect(result).toEqual({
    updated: [],
    skipped: ["c1"],
    failed: [{ id: "c2", reason: "invalid_token" }],
  });
});
