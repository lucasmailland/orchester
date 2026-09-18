import "server-only";
import crypto from "node:crypto";
import { decrypt } from "@/lib/encryption";
import { fetchWithTimeout } from "@/lib/http-util";

const DISCORD_TIMEOUT_MS = 15_000;
const DISCORD_API = "https://discord.com/api/v10";
/** Discord rejects message content longer than this. */
const MAX_CONTENT = 2000;

/**
 * Discord channel adapter — slash commands via the Interactions endpoint.
 *
 * Setup that the operator does:
 *   1. Create an application at https://discord.com/developers/applications
 *   2. Copy the Application ID and the Public Key (General Information)
 *   3. Bot → Reset Token, copy the bot token
 *   4. Paste all three into Orchester /channels (Discord form) — saving
 *      registers the slash command and prints the Interactions Endpoint URL
 *   5. General Information → Interactions Endpoint URL = that URL. Discord
 *      verifies it by sending a signed PING plus a deliberately corrupted one,
 *      so the signature check below must reject the bad one with 401.
 *   6. OAuth2 → URL Generator → scopes `applications.commands` and `bot`,
 *      then open the generated URL to install the app on the server.
 */

export interface DiscordCredentials {
  /** Application ID — the followup URL is built from it. */
  applicationId: string;
  /** Public Key (hex) — verifies that a request really came from Discord. */
  publicKey: string;
  /** Bot token — only used to register the slash command. */
  botToken: string;
}

export function decodeDiscordCredentials(encrypted: string | null): DiscordCredentials | null {
  if (!encrypted) return null;
  try {
    const parsed = JSON.parse(decrypt(encrypted)) as Partial<DiscordCredentials>;
    if (!parsed.applicationId || !parsed.publicKey || !parsed.botToken) return null;
    return {
      applicationId: parsed.applicationId,
      publicKey: parsed.publicKey,
      botToken: parsed.botToken,
    };
  } catch {
    return null;
  }
}

/** SPKI header for a raw 32-byte Ed25519 key — Node needs the DER wrapper. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Verify the `X-Signature-Ed25519` header.
 * Discord signs `timestamp + rawBody`, so the body must be the bytes as
 * received: re-serializing the parsed JSON reorders keys and breaks the check.
 *
 * Every failure mode returns false rather than throwing — a malformed header
 * from an attacker must not turn into a 500.
 */
export function verifyDiscordSignature(params: {
  publicKey: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  rawBody: string;
}): boolean {
  const { publicKey, signatureHeader, timestampHeader, rawBody } = params;
  if (!signatureHeader || !timestampHeader) return false;
  if (!/^[0-9a-fA-F]{128}$/.test(signatureHeader)) return false;
  if (!/^[0-9a-fA-F]{64}$/.test(publicKey)) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, "hex")]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(
      null,
      Buffer.from(timestampHeader + rawBody, "utf8"),
      key,
      Buffer.from(signatureHeader, "hex")
    );
  } catch {
    return false;
  }
}

/** Discord interaction types we care about. */
export const DISCORD_PING = 1;
export const DISCORD_APPLICATION_COMMAND = 2;

/** Discord interaction response types. */
export const DISCORD_PONG = 1;
/** Reply now — used for refusals, which are ready without calling the agent. */
export const DISCORD_REPLY = 4;
/** "Orchester is thinking…" — buys 15 minutes to answer a slash command. */
export const DISCORD_DEFERRED_REPLY = 5;
/** Only the person who ran the command sees the message. */
export const DISCORD_EPHEMERAL = 64;

export interface DiscordInteraction {
  type: number;
  token?: string;
  channel_id?: string;
  guild_id?: string;
  data?: {
    name?: string;
    options?: { name?: string; value?: unknown }[];
  };
  /** Present in a guild. */
  member?: { user?: { id?: string; username?: string } };
  /** Present in a DM. */
  user?: { id?: string; username?: string };
}

/** The person who ran the command, from wherever Discord put them. */
export function interactionSender(interaction: DiscordInteraction): {
  id: string;
  username?: string;
} | null {
  const user = interaction.member?.user ?? interaction.user;
  if (!user?.id) return null;
  return user.username ? { id: user.id, username: user.username } : { id: user.id };
}

/** The text the person typed into the command's option. */
export function interactionText(interaction: DiscordInteraction, optionName: string): string {
  const option = interaction.data?.options?.find((o) => o.name === optionName);
  return typeof option?.value === "string" ? option.value.trim() : "";
}

/** Cut to Discord's limit without splitting a surrogate pair in half. */
export function truncateForDiscord(content: string): string {
  if (content.length <= MAX_CONTENT) return content;
  return content.slice(0, MAX_CONTENT - 1).replace(/[\uD800-\uDBFF]$/, "") + "…";
}

/**
 * Replace the "thinking…" placeholder with the real answer.
 * The interaction token authenticates this call, so it carries no bot token —
 * and it expires 15 minutes after the command was run.
 */
export async function discordEditReply(
  applicationId: string,
  interactionToken: string,
  content: string
): Promise<void> {
  const r = await fetchWithTimeout(
    `${DISCORD_API}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(
      interactionToken
    )}/messages/@original`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: truncateForDiscord(content) }),
    },
    DISCORD_TIMEOUT_MS
  );
  if (!r.ok) {
    throw new Error(`Discord edit reply ${r.status}: ${await r.text().catch(() => "")}`);
  }
}

/**
 * Post into a Discord channel as the bot.
 * Used when an operator takes a conversation over: the interaction token that
 * answered the slash command has long expired, so the reply goes through the
 * bot instead, addressed to the person who asked.
 */
export async function discordPostToChannel(
  botToken: string,
  channelId: string,
  content: string,
  mentionUserId?: string
): Promise<void> {
  if (!content) return;
  const body = mentionUserId ? `<@${mentionUserId}> ${content}` : content;
  const r = await fetchWithTimeout(
    `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bot ${botToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: truncateForDiscord(body) }),
    },
    DISCORD_TIMEOUT_MS
  );
  if (!r.ok) {
    throw new Error(`Discord post message ${r.status}: ${await r.text().catch(() => "")}`);
  }
}

/** Command names Discord accepts: lowercase, no spaces, 1-32 characters. */
export const DISCORD_COMMAND_NAME = /^[-_a-z0-9]{1,32}$/;

/** Used when the channel config names no command. */
export const DISCORD_DEFAULT_COMMAND = "orchester";
/**
 * The command's single option. Registration writes it and the webhook reads it,
 * so it is a constant rather than config: the two must never drift apart.
 */
export const DISCORD_OPTION_NAME = "message";
export const DISCORD_COMMAND_DESCRIPTION = "Ask the agent connected to this channel";

/** The command name this channel answers to. */
export function discordCommandName(config: Record<string, unknown> | null | undefined): string {
  const name = config?.["commandName"];
  return typeof name === "string" && DISCORD_COMMAND_NAME.test(name)
    ? name
    : DISCORD_DEFAULT_COMMAND;
}

/**
 * Register (or overwrite) the channel's single global slash command.
 * PUT replaces the whole set, which keeps a renamed command from leaving its
 * old name behind. Global commands can take up to an hour to appear.
 */
export async function discordRegisterCommand(params: {
  applicationId: string;
  botToken: string;
  commandName: string;
  optionName: string;
  description: string;
}): Promise<void> {
  const { applicationId, botToken, commandName, optionName, description } = params;
  if (!DISCORD_COMMAND_NAME.test(commandName)) {
    throw new Error(`Invalid Discord command name: ${commandName}`);
  }
  const r = await fetchWithTimeout(
    `${DISCORD_API}/applications/${encodeURIComponent(applicationId)}/commands`,
    {
      method: "PUT",
      headers: {
        authorization: `Bot ${botToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        {
          name: commandName,
          description,
          // 1 = CHAT_INPUT
          type: 1,
          options: [
            {
              // 3 = STRING
              type: 3,
              name: optionName,
              description: "What you want to ask",
              required: true,
            },
          ],
        },
      ]),
    },
    DISCORD_TIMEOUT_MS
  );
  if (!r.ok) {
    throw new Error(`Discord register command ${r.status}: ${await r.text().catch(() => "")}`);
  }
}
