import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  inbound: vi.fn(),
  telegramSend: vi.fn(),
  decodeTelegram: vi.fn(),
  slackSend: vi.fn(),
  react: vi.fn(),
  thinking: vi.fn(),
  signature: vi.fn(),
}));
vi.mock("@/lib/tenant/cron", () => ({ withCrossTenantAdmin: mocks.lookup }));
vi.mock("@/lib/channels/router", () => ({ handleInbound: mocks.inbound }));
vi.mock("@/lib/channels/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/channels/telegram")>()),
  decodeTelegramCredentials: mocks.decodeTelegram,
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
function channel(type: string, config?: Record<string, unknown>) {
  mocks.lookup.mockResolvedValue({
    id: "channel_test",
    workspaceId: "workspace_test",
    name: "Private test channel",
    type,
    status: "active",
    config: config ?? {},
    credentialsEncrypted: "test-encrypted",
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.inbound.mockResolvedValue({ reply: "Test reply" });
  // Sin `webhookSecret`: un canal registrado antes de que existiera la
  // verificación del header. Pasa, y deja un warning.
  mocks.decodeTelegram.mockReturnValue({ botToken: "test-token" });
  mocks.signature.mockReturnValue(true);
  mocks.react.mockResolvedValue(undefined);
  mocks.thinking.mockResolvedValue(undefined);
});
it("Telegram refuses strangers before handleInbound and sends only the sender ID", async () => {
  channel("telegram", { allowedSenders: ["7654321"] });
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
it.each([
  { config: { allowAnySender: true } },
  { config: { allowedSenders: [], allowAnySender: true } },
  { config: { allowedSenders: ["1234567"] } },
  { config: { allowedSenders: ["@TEST_SENDER"] } },
])("Telegram allows %j", async ({ config }) => {
  channel("telegram", config);
  await telegram(
    request({
      message: { chat: { id: 1234567 }, from: { username: "test_sender" }, text: "Hello" },
    }),
    params
  );
  expect(mocks.inbound).toHaveBeenCalledOnce();
});
// El secreto de la URL no prueba que el pedido venga de Telegram: una URL
// aparece en logs de proxy, en el historial del navegador y en capturas de
// pantalla. Telegram devuelve en un header el `secret_token` que registramos.
function requestConHeader(body: unknown, header?: string) {
  return new Request("https://example.com", {
    method: "POST",
    body: JSON.stringify(body),
    ...(header === undefined ? {} : { headers: { "x-telegram-bot-api-secret-token": header } }),
  });
}
const mensaje = { message: { chat: { id: 1234567 }, text: "Hello" } };

it.each([
  ["no manda el header", undefined],
  ["manda otro valor", "b".repeat(48)],
  ["manda el header vacío", ""],
])("Telegram rechaza a quien tiene la URL pero %s", async (_caso, header) => {
  channel("telegram", { allowAnySender: true });
  mocks.decodeTelegram.mockReturnValue({ botToken: "test-token", webhookSecret: "a".repeat(48) });
  const response = await telegram(requestConHeader(mensaje, header), params);
  // Mismo 404 que un canal inexistente: una URL filtrada no sirve para
  // averiguar qué canales existen.
  expect(response.status).toBe(404);
  expect(mocks.inbound).not.toHaveBeenCalled();
  // Y no le contesta nada al impostor.
  expect(mocks.telegramSend).not.toHaveBeenCalled();
});

it("Telegram acepta el header que registró", async () => {
  channel("telegram", { allowAnySender: true });
  mocks.decodeTelegram.mockReturnValue({ botToken: "test-token", webhookSecret: "a".repeat(48) });
  await telegram(requestConHeader(mensaje, "a".repeat(48)), params);
  expect(mocks.inbound).toHaveBeenCalledOnce();
});

it("Telegram deja pasar un canal registrado antes de que existiera el header", async () => {
  // Romper todos los canales que ya andan es peor que el agujero. Pasa, y el
  // warning del log dice qué canal hay que volver a guardar.
  channel("telegram", { allowAnySender: true });
  mocks.decodeTelegram.mockReturnValue({ botToken: "test-token" });
  await telegram(requestConHeader(mensaje, undefined), params);
  expect(mocks.inbound).toHaveBeenCalledOnce();
});

it("Telegram uses the sender username, not a group username", async () => {
  channel("telegram", { allowedSenders: ["@test_group"] });
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
  channel("slack", { allowedSenders: ["U_OTHER_TEST"] });
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
it.each([
  { config: { allowAnySender: true } },
  { config: { allowedSenders: [], allowAnySender: true } },
  { config: { allowedSenders: ["U_TEST"] } },
  { config: { allowedSenders: ["C_TEST"] } },
])("Slack allows %j", async ({ config }) => {
  channel("slack", config);
  await slack(request(slackEvent), params);
  expect(mocks.inbound).toHaveBeenCalledOnce();
});
it("Slack still rejects invalid signatures before sending a refusal", async () => {
  channel("slack", { allowedSenders: ["U_OTHER_TEST"] });
  mocks.signature.mockReturnValue(false);
  expect((await slack(request(slackEvent), params)).status).toBe(401);
  expect(mocks.inbound).not.toHaveBeenCalled();
  expect(mocks.slackSend).not.toHaveBeenCalled();
});
