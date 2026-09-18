import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  inbound: vi.fn(),
  editReply: vi.fn(),
  signature: vi.fn(),
  after: vi.fn(),
}));

// `after` needs a live request scope, which a unit test has no way to give it.
// Capturing the callback instead lets the test run it and assert on what the
// person actually ends up seeing in Discord.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("@/lib/tenant/cron", () => ({ withCrossTenantAdmin: mocks.lookup }));
vi.mock("@/lib/channels/router", () => ({ handleInbound: mocks.inbound }));
vi.mock("@/lib/channels/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/channels/discord")>()),
  decodeDiscordCredentials: () => ({
    applicationId: "test-app",
    publicKey: "test-key",
    botToken: "test-token",
  }),
  discordEditReply: mocks.editReply,
  verifyDiscordSignature: mocks.signature,
}));

const { POST } = await import("@/app/api/channels/discord/webhook/[secret]/route");
const params = { params: Promise.resolve({ secret: "test-secret" }) };

function request(body: unknown) {
  return new Request("https://example.com", { method: "POST", body: JSON.stringify(body) });
}
function channel(config: Record<string, unknown> = {}, type = "discord") {
  mocks.lookup.mockResolvedValue({
    id: "channel_test",
    workspaceId: "workspace_test",
    name: "Private test channel",
    type,
    status: "active",
    config,
    credentialsEncrypted: "test-encrypted",
  });
}
function command(options: {
  name?: string;
  text?: string;
  userId?: string;
  username?: string;
  token?: string;
}) {
  return request({
    type: 2,
    token: options.token ?? "interaction-token",
    channel_id: "chan-1",
    guild_id: "guild-1",
    data: {
      name: options.name ?? "orchester",
      options: [{ name: "message", value: options.text ?? "what is open?" }],
    },
    member: { user: { id: options.userId ?? "user-1", username: options.username ?? "ana" } },
  });
}
/** Run the work the route deferred past its Discord acknowledgement. */
async function runDeferred() {
  expect(mocks.after).toHaveBeenCalledTimes(1);
  await mocks.after.mock.calls[0]![0]!();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inbound.mockResolvedValue({ reply: "Test reply" });
  mocks.signature.mockReturnValue(true);
  mocks.editReply.mockResolvedValue(undefined);
});

it("rejects a request Discord did not sign, before looking at the body", async () => {
  channel();
  mocks.signature.mockReturnValue(false);
  const response = await POST(command({}), params);
  expect(response.status).toBe(401);
  expect(mocks.inbound).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
});

it("answers Discord's PING with a PONG", async () => {
  channel();
  const response = await POST(request({ type: 1 }), params);
  expect(await response.json()).toEqual({ type: 1 });
  expect(mocks.inbound).not.toHaveBeenCalled();
});

it("verifies the signature against the bytes as received", async () => {
  channel();
  // A body re-serialized from the parsed JSON would not match Discord's signature.
  const body = JSON.stringify({ type: 1, spacing: "  kept  " });
  await POST(new Request("https://example.com", { method: "POST", body }), params);
  expect(mocks.signature).toHaveBeenCalledWith(expect.objectContaining({ rawBody: body }));
});

it("is not found when the channel is another kind", async () => {
  channel({}, "telegram");
  expect((await POST(command({}), params)).status).toBe(404);
});

it("is not found when the channel is paused", async () => {
  channel();
  mocks.lookup.mockResolvedValue({ type: "discord", status: "inactive" });
  expect((await POST(command({}), params)).status).toBe(404);
});

it("refuses a stranger before handleInbound and shows only their own ID", async () => {
  channel({ allowedSenders: ["user-allowed"] });
  const response = await POST(command({ userId: "user-stranger" }), params);
  const body = await response.json();
  // Type 4 replies immediately: a refusal needs no agent, so no deferral.
  expect(body.type).toBe(4);
  expect(body.data.content).toBe("You do not have access. Your ID: user-stranger.");
  // Flag 64 is ephemeral — nobody else in the server reads the refusal.
  expect(body.data.flags).toBe(64);
  expect(mocks.inbound).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
});

it("lets an allowed sender through", async () => {
  channel({ allowedSenders: ["user-1"] });
  const response = await POST(command({ userId: "user-1" }), params);
  expect((await response.json()).type).toBe(5);
});

it("matches an allowlist entry by username", async () => {
  channel({ allowedSenders: ["ana"] });
  const response = await POST(command({ userId: "user-9", username: "ana" }), params);
  expect((await response.json()).type).toBe(5);
});

it("defers the answer and edits the real reply in afterwards", async () => {
  channel();
  const response = await POST(command({ text: "what is open?" }), params);
  // Discord drops the interaction after three seconds, so the acknowledgement
  // must go out before the agent runs.
  expect((await response.json()).type).toBe(5);
  expect(mocks.inbound).not.toHaveBeenCalled();

  await runDeferred();
  expect(mocks.inbound).toHaveBeenCalledWith(
    "workspace_test",
    expect.objectContaining({
      channelId: "channel_test",
      externalId: "chan-1:user-1",
      text: "what is open?",
      customerName: "ana",
    })
  );
  expect(mocks.editReply).toHaveBeenCalledWith("test-app", "interaction-token", "Test reply");
});

it("tells the person when the agent fails instead of leaving them waiting", async () => {
  channel();
  mocks.inbound.mockRejectedValue(new Error("agent exploded"));
  await POST(command({}), params);
  await runDeferred();
  expect(mocks.editReply).toHaveBeenCalledWith(
    "test-app",
    "interaction-token",
    expect.stringContaining("agent exploded")
  );
});

it("says something when the agent returns an empty answer", async () => {
  channel();
  mocks.inbound.mockResolvedValue({ reply: "" });
  await POST(command({}), params);
  await runDeferred();
  expect(mocks.editReply.mock.calls[0]![2]).toBeTruthy();
});

it("names the command this channel answers to when another one arrives", async () => {
  channel({ commandName: "soporte" });
  const response = await POST(command({ name: "orchester" }), params);
  const body = await response.json();
  expect(body.type).toBe(4);
  expect(body.data.content).toContain("/soporte");
  expect(mocks.after).not.toHaveBeenCalled();
});

it("accepts the configured command name", async () => {
  channel({ commandName: "soporte" });
  const response = await POST(command({ name: "soporte" }), params);
  expect((await response.json()).type).toBe(5);
});

it("asks for text when the command carries none", async () => {
  channel();
  const response = await POST(command({ text: "   " }), params);
  expect((await response.json()).type).toBe(4);
  expect(mocks.after).not.toHaveBeenCalled();
});

it("ignores interaction types it does not handle", async () => {
  channel();
  const response = await POST(request({ type: 4, data: { name: "orchester" } }), params);
  expect(await response.json()).toEqual({ ok: true });
  expect(mocks.after).not.toHaveBeenCalled();
});
