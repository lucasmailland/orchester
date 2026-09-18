import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

vi.mock("@/lib/encryption", () => ({
  decrypt: (value: string) => value,
}));

const {
  DISCORD_COMMAND_NAME,
  decodeDiscordCredentials,
  discordCommandName,
  discordEditReply,
  discordPostToChannel,
  discordRegisterCommand,
  interactionSender,
  interactionText,
  truncateForDiscord,
  verifyDiscordSignature,
} = await import("@/lib/channels/discord");

/** A throwaway Ed25519 pair, generated per run — nothing here is a real key. */
function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { privateKey, publicKeyHex: raw.toString("hex") };
}

function sign(privateKey: crypto.KeyObject, timestamp: string, body: string) {
  return crypto.sign(null, Buffer.from(timestamp + body, "utf8"), privateKey).toString("hex");
}

describe("verifyDiscordSignature", () => {
  const { privateKey, publicKeyHex } = keypair();
  // Within the replay window, which is checked against the wall clock.
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({ type: 1 });

  it("accepts a request Discord actually signed", () => {
    expect(
      verifyDiscordSignature({
        publicKey: publicKeyHex,
        signatureHeader: sign(privateKey, timestamp, rawBody),
        timestampHeader: timestamp,
        rawBody,
      })
    ).toBe(true);
  });

  it("rejects a body changed after signing", () => {
    // Discord validates a new endpoint by sending exactly this: a correctly
    // signed request and a corrupted one. Accepting the second fails setup.
    expect(
      verifyDiscordSignature({
        publicKey: publicKeyHex,
        signatureHeader: sign(privateKey, timestamp, rawBody),
        timestampHeader: timestamp,
        rawBody: JSON.stringify({ type: 2 }),
      })
    ).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const other = keypair();
    expect(
      verifyDiscordSignature({
        publicKey: publicKeyHex,
        signatureHeader: sign(other.privateKey, timestamp, rawBody),
        timestampHeader: timestamp,
        rawBody,
      })
    ).toBe(false);
  });

  it("rejects a timestamp that was not the one signed", () => {
    expect(
      verifyDiscordSignature({
        publicKey: publicKeyHex,
        signatureHeader: sign(privateKey, timestamp, rawBody),
        timestampHeader: String(Number(timestamp) + 1),
        rawBody,
      })
    ).toBe(false);
  });

  it("rejects a correctly signed request that is too old to still be live", () => {
    // A signature never decays on its own: without a window, one captured
    // request can be replayed forever, each replay running a full agent turn.
    const old = String(Math.floor(Date.now() / 1000) - 301);
    expect(
      verifyDiscordSignature({
        publicKey: publicKeyHex,
        signatureHeader: sign(privateKey, old, rawBody),
        timestampHeader: old,
        rawBody,
      })
    ).toBe(false);
  });

  it("accepts a request from inside the window", () => {
    const recent = String(Math.floor(Date.now() / 1000) - 299);
    expect(
      verifyDiscordSignature({
        publicKey: publicKeyHex,
        signatureHeader: sign(privateKey, recent, rawBody),
        timestampHeader: recent,
        rawBody,
      })
    ).toBe(true);
  });

  it("rejects a clock far in the future as readily as one in the past", () => {
    const ahead = String(Math.floor(Date.now() / 1000) + 400);
    expect(
      verifyDiscordSignature({
        publicKey: publicKeyHex,
        signatureHeader: sign(privateKey, ahead, rawBody),
        timestampHeader: ahead,
        rawBody,
      })
    ).toBe(false);
  });

  it("rejects a timestamp that is not a number", () => {
    expect(
      verifyDiscordSignature({
        publicKey: publicKeyHex,
        signatureHeader: sign(privateKey, "later", rawBody),
        timestampHeader: "later",
        rawBody,
      })
    ).toBe(false);
  });

  it.each([
    ["missing signature", null, timestamp],
    ["missing timestamp", "a".repeat(128), null],
    ["signature of the wrong length", "abcd", timestamp],
    ["signature that is not hex", "z".repeat(128), timestamp],
  ])("returns false for a %s rather than throwing", (_label, signature, ts) => {
    expect(
      verifyDiscordSignature({
        publicKey: publicKeyHex,
        signatureHeader: signature,
        timestampHeader: ts,
        rawBody,
      })
    ).toBe(false);
  });

  it("returns false for a malformed public key rather than throwing", () => {
    expect(
      verifyDiscordSignature({
        publicKey: "not-a-key",
        signatureHeader: sign(privateKey, timestamp, rawBody),
        timestampHeader: timestamp,
        rawBody,
      })
    ).toBe(false);
  });
});

describe("decodeDiscordCredentials", () => {
  it("reads all three values", () => {
    const encoded = JSON.stringify({
      applicationId: "app",
      publicKey: "key",
      botToken: "token",
    });
    expect(decodeDiscordCredentials(encoded)).toEqual({
      applicationId: "app",
      publicKey: "key",
      botToken: "token",
    });
  });

  it.each([
    ["null", null],
    ["not JSON", "{"],
    ["missing the application ID", JSON.stringify({ publicKey: "k", botToken: "t" })],
    ["missing the public key", JSON.stringify({ applicationId: "a", botToken: "t" })],
    ["missing the bot token", JSON.stringify({ applicationId: "a", publicKey: "k" })],
  ])("returns null when the payload is %s", (_label, value) => {
    expect(decodeDiscordCredentials(value)).toBeNull();
  });
});

describe("reading the interaction", () => {
  it("takes the sender from member.user in a guild", () => {
    expect(interactionSender({ type: 2, member: { user: { id: "1", username: "ana" } } })).toEqual({
      id: "1",
      username: "ana",
    });
  });

  it("takes the sender from user in a DM", () => {
    expect(interactionSender({ type: 2, user: { id: "2", username: "bruno" } })).toEqual({
      id: "2",
      username: "bruno",
    });
  });

  it("omits an absent username instead of carrying undefined", () => {
    expect(interactionSender({ type: 2, user: { id: "3" } })).toEqual({ id: "3" });
  });

  it("returns null when Discord names nobody", () => {
    expect(interactionSender({ type: 2 })).toBeNull();
  });

  it("reads and trims the named option", () => {
    const interaction = {
      type: 2,
      data: {
        options: [
          { name: "other", value: "no" },
          { name: "message", value: "  hola  " },
        ],
      },
    };
    expect(interactionText(interaction, "message")).toBe("hola");
  });

  it.each([
    ["the option is absent", { type: 2, data: { options: [] } }],
    ["there are no options", { type: 2, data: {} }],
    ["the value is not a string", { type: 2, data: { options: [{ name: "message", value: 7 }] } }],
  ])("returns an empty string when %s", (_label, interaction) => {
    expect(interactionText(interaction, "message")).toBe("");
  });
});

describe("discordCommandName", () => {
  it("uses the configured name", () => {
    expect(discordCommandName({ commandName: "soporte" })).toBe("soporte");
  });

  it.each([
    ["no config", null],
    ["an empty config", {}],
    ["a name with spaces", { commandName: "two words" }],
    ["a name with uppercase", { commandName: "Orchester" }],
    ["a name that is not a string", { commandName: 7 }],
    ["a name over 32 characters", { commandName: "a".repeat(33) }],
  ])("falls back to the default for %s", (_label, config) => {
    expect(discordCommandName(config as Record<string, unknown> | null)).toBe("orchester");
  });
});

describe("truncateForDiscord", () => {
  it("leaves a message at the limit alone", () => {
    const content = "a".repeat(2000);
    expect(truncateForDiscord(content)).toBe(content);
  });

  it("cuts a longer message to the limit", () => {
    expect(truncateForDiscord("a".repeat(2001))).toHaveLength(2000);
  });

  it("does not leave half of an emoji at the cut", () => {
    // The 2000th character would be the lead surrogate of the last emoji.
    const content = "a".repeat(1998) + "😀😀";
    const out = truncateForDiscord(content);
    expect(out).toBe("a".repeat(1998) + "…");
    expect(/[\uD800-\uDBFF]$/.test(out.slice(0, -1))).toBe(false);
  });
});

describe("outbound calls", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("edits the deferred reply without sending the bot token", async () => {
    await discordEditReply("app-1", "tok-1", "the answer");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://discord.com/api/v10/webhooks/app-1/tok-1/messages/@original");
    expect(init.method).toBe("PATCH");
    // The interaction token is the credential here; a bot token would be a leak.
    expect(init.headers).not.toHaveProperty("authorization");
    // No mentions parsed: the content is whatever the agent wrote, and an
    // "@everyone" in it would otherwise ping the whole server.
    expect(JSON.parse(init.body)).toEqual({
      content: "the answer",
      allowed_mentions: { parse: [] },
    });
  });

  it("truncates an over-long reply before sending it", async () => {
    await discordEditReply("app-1", "tok-1", "a".repeat(3000));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).content).toHaveLength(2000);
  });

  it("reports the status when Discord rejects the edit", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(discordEditReply("app-1", "tok-1", "x")).rejects.toThrow("Discord edit reply 401");
  });

  it("posts as the bot and mentions the person it is answering", async () => {
    await discordPostToChannel("bot-token", "chan-1", "here you go", "user-9");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://discord.com/api/v10/channels/chan-1/messages");
    expect(init.headers.authorization).toBe("Bot bot-token");
    expect(JSON.parse(init.body)).toEqual({
      content: "<@user-9> here you go",
      // Only the person being answered gets pinged, never a role or @everyone.
      allowed_mentions: { parse: [], users: ["user-9"] },
    });
  });

  it("pings nobody at all when the reply names nobody", async () => {
    await discordPostToChannel("bot-token", "chan-1", "@everyone look at this");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).allowed_mentions).toEqual({
      parse: [],
      users: [],
    });
  });

  it("posts without a mention when nobody is named", async () => {
    await discordPostToChannel("bot-token", "chan-1", "here you go");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).content).toBe("here you go");
  });

  it("sends nothing for empty content", async () => {
    await discordPostToChannel("bot-token", "chan-1", "");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers the command as a full replacement of the command set", async () => {
    await discordRegisterCommand({
      applicationId: "app-1",
      botToken: "bot-token",
      commandName: "orchester",
      optionName: "message",
      description: "Ask",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://discord.com/api/v10/applications/app-1/commands");
    // PUT replaces the whole set, so a renamed command leaves no orphan behind.
    expect(init.method).toBe("PUT");
    expect(init.headers.authorization).toBe("Bot bot-token");
    const body = JSON.parse(init.body);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      name: "orchester",
      type: 1,
      options: [{ type: 3, name: "message", required: true }],
    });
  });

  it("refuses a command name Discord would reject, without calling Discord", async () => {
    await expect(
      discordRegisterCommand({
        applicationId: "app-1",
        botToken: "bot-token",
        commandName: "Two Words",
        optionName: "message",
        description: "Ask",
      })
    ).rejects.toThrow("Invalid Discord command name");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the status when registration fails", async () => {
    fetchMock.mockResolvedValue(new Response("bad token", { status: 401 }));
    await expect(
      discordRegisterCommand({
        applicationId: "app-1",
        botToken: "bot-token",
        commandName: "orchester",
        optionName: "message",
        description: "Ask",
      })
    ).rejects.toThrow("Discord register command 401");
  });
});

it("the command name pattern matches what Discord accepts", () => {
  expect(DISCORD_COMMAND_NAME.test("orchester")).toBe(true);
  expect(DISCORD_COMMAND_NAME.test("a-b_9")).toBe(true);
  expect(DISCORD_COMMAND_NAME.test("")).toBe(false);
  expect(DISCORD_COMMAND_NAME.test("A")).toBe(false);
});
