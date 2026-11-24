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
function fakeTx(rows: Row[]) {
  const writes: { id: string; credentialsEncrypted: string }[] = [];
  const tx = {
    select: () => ({ from: () => ({ where: async () => rows }) }),
    update: () => ({
      set: (v: { credentialsEncrypted: string }) => ({
        where: async () => {
          writes.push({ id: "x", credentialsEncrypted: v.credentialsEncrypted });
        },
      }),
    }),
  };
  return { tx: tx as never, writes };
}
const enc = (o: object) => `enc:${JSON.stringify(o)}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => ({ ok: true, result: { username: "test_bot" } }),
    text: async () => "",
    url,
  }));
});

it("registers a secret on a channel without one and leaves a signed one alone", async () => {
  const { tx, writes } = fakeTx([
    { id: "c1", workspaceId: "w", secret: "s1", credentialsEncrypted: enc({ botToken: "t1" }) },
    {
      id: "c2",
      workspaceId: "w",
      secret: "s2",
      credentialsEncrypted: enc({ botToken: "t2", webhookSecret: "a".repeat(48) }),
    },
  ]);
  const result = await telegram.registerMissingTelegramSecrets(tx);
  expect(result).toEqual({ updated: ["c1"], failed: [] });
  expect(writes).toHaveLength(1);
  const creds = telegram.decodeTelegramCredentials(writes[0]!.credentialsEncrypted);
  expect(creds?.botToken).toBe("t1");
  expect(creds?.webhookSecret).toMatch(/^[0-9a-f]{48}$/);
});

it("keeps the stored credentials when setWebhook fails", async () => {
  fetchMock.mockImplementation(async (url: string) =>
    String(url).endsWith("/setWebhook")
      ? { ok: false, status: 500, text: async () => "boom" }
      : { ok: true, json: async () => ({ ok: true }) }
  );
  const { tx, writes } = fakeTx([
    { id: "c1", workspaceId: "w", secret: "s1", credentialsEncrypted: enc({ botToken: "t1" }) },
  ]);
  const result = await telegram.registerMissingTelegramSecrets(tx);
  expect(result).toEqual({ updated: [], failed: ["c1"] });
  expect(writes).toHaveLength(0);
});
