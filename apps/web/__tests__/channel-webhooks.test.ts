import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  inbound: vi.fn(),
  telegramSend: vi.fn(),
  slackSend: vi.fn(),
  react: vi.fn(),
  thinking: vi.fn(),
  signature: vi.fn(),
}));
vi.mock("@/lib/tenant/cron", () => ({ withCrossTenantAdmin: mocks.lookup }));
vi.mock("@/lib/channels/router", () => ({ handleInbound: mocks.inbound }));
vi.mock("@/lib/channels/telegram", () => ({
  decodeTelegramCredentials: () => ({ botToken: "test-token" }),
  telegramSend: mocks.telegramSend,
}));
vi.mock("@/lib/channels/slack", () => ({
  decodeSlackCredentials: () => ({ botToken: "test-token", signingSecret: "test-secret" }),
  slackSend: mocks.slackSend,
  slackReact: mocks.react,
  slackSetThinkingStatus: mocks.thinking,
  verifySlackSignature: mocks.signature,
}));
const { POST: telegram } = await import("@/app/api/channels/telegram/webhook/[secret]/route");
const { POST: slack } = await import("@/app/api/channels/slack/webhook/[secret]/route");
const params = { params: Promise.resolve({ secret: "test-secret" }) };
function request(body: unknown) {
  return new Request("https://example.com", { method: "POST", body: JSON.stringify(body) });
}
function channel(type: string, allowedSenders?: string[]) {
  mocks.lookup.mockResolvedValue({
    id: "channel_test",
    workspaceId: "workspace_test",
    name: "Private test channel",
    type,
    status: "active",
    config: { allowedSenders },
    credentialsEncrypted: "test-encrypted",
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.inbound.mockResolvedValue({ reply: "Test reply" });
  mocks.signature.mockReturnValue(true);
  mocks.react.mockResolvedValue(undefined);
  mocks.thinking.mockResolvedValue(undefined);
});
it("Telegram refuses strangers before handleInbound and sends only the sender ID", async () => {
  channel("telegram", ["7654321"]);
  const response = await telegram(
    request({ message: { chat: { id: 1234567 }, text: "Hello" } }),
    params
  );
  expect(response.status).toBe(200);
  expect(mocks.inbound).not.toHaveBeenCalled();
  expect(mocks.telegramSend).toHaveBeenCalledWith(
    "test-token",
    1234567,
    "You do not have access. Your ID: 1234567."
  );
});
it.each([undefined, [], ["1234567"], ["@TEST_SENDER"]].map((allowed) => ({ allowed })))(
  "Telegram allows %j",
  async ({ allowed }) => {
    channel("telegram", allowed);
    await telegram(
      request({
        message: { chat: { id: 1234567 }, from: { username: "test_sender" }, text: "Hello" },
      }),
      params
    );
    expect(mocks.inbound).toHaveBeenCalledOnce();
  }
);
it("Telegram uses the sender username, not a group username", async () => {
  channel("telegram", ["@test_group"]);
  await telegram(
    request({
      message: {
        chat: { id: -1234567, username: "test_group" },
        from: { username: "test_stranger" },
        text: "Hello",
      },
    }),
    params
  );
  expect(mocks.inbound).not.toHaveBeenCalled();
});
const slackEvent = {
  type: "event_callback",
  event: {
    type: "app_mention",
    user: "U_TEST",
    channel: "C_TEST",
    text: "Hello",
    ts: "1.0",
    thread_ts: "0.0",
  },
};
it("Slack refuses before router and thinking feedback, replying in the same thread", async () => {
  channel("slack", ["U_OTHER_TEST"]);
  const response = await slack(request(slackEvent), params);
  expect(response.status).toBe(200);
  expect(mocks.inbound).not.toHaveBeenCalled();
  expect(mocks.react).not.toHaveBeenCalled();
  expect(mocks.thinking).not.toHaveBeenCalled();
  expect(mocks.slackSend).toHaveBeenCalledWith(
    "test-token",
    "C_TEST",
    "You do not have access. Your ID: U_TEST.",
    "0.0"
  );
});
it.each([undefined, [], ["U_TEST"], ["C_TEST"]].map((allowed) => ({ allowed })))(
  "Slack allows %j",
  async ({ allowed }) => {
    channel("slack", allowed);
    await slack(request(slackEvent), params);
    expect(mocks.inbound).toHaveBeenCalledOnce();
  }
);
it("Slack still rejects invalid signatures before sending a refusal", async () => {
  channel("slack", ["U_OTHER_TEST"]);
  mocks.signature.mockReturnValue(false);
  expect((await slack(request(slackEvent), params)).status).toBe(401);
  expect(mocks.inbound).not.toHaveBeenCalled();
  expect(mocks.slackSend).not.toHaveBeenCalled();
});
