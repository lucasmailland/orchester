import "server-only";

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Telegram needs ${name}.`);
  return value;
}

/** The bot token belongs in the path; never surface response data or unsanitized errors. */
async function post(
  config: Record<string, string>,
  method: "getMe" | "sendMessage",
  body: Record<string, unknown>
) {
  const token = requiredText(config.botToken, "a bot token").trim();
  if (!/^[A-Za-z0-9_:-]+$/.test(token)) throw new Error("Invalid Telegram bot token.");
  const scrub = (text: string) =>
    text.split(encodeURIComponent(token)).join("[redacted]").split(token).join("[redacted]");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: ac.signal,
    });
    const text = await res.text();
    const detail = scrub(text).trim().slice(0, 200);
    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${detail}`);
    let data: { ok?: boolean } | null;
    try {
      data = JSON.parse(text) as { ok?: boolean } | null;
    } catch {
      throw new Error(`Telegram returned a non-JSON response (HTTP ${res.status}): ${detail}`);
    }
    if (data?.ok !== true) throw new Error(`Telegram HTTP ${res.status}: ${detail}`);
    return { ok: true, status: res.status };
  } catch (e) {
    throw new Error(scrub(e instanceof Error ? e.message : String(e)).slice(0, 240));
  } finally {
    clearTimeout(timer);
  }
}

export async function telegramTest(config: Record<string, string>): Promise<void> {
  requiredText(config.defaultChatId, "defaultChatId");
  await post(config, "getMe", {});
}

export async function telegramSendMessage(
  config: Record<string, string>,
  input: Record<string, unknown>
) {
  const text = requiredText(input.text, "text");
  const chatId = requiredText(input.chatId ?? config.defaultChatId, "chatId or defaultChatId");
  const parseMode = input.parseMode;
  if (
    parseMode !== undefined &&
    parseMode !== "none" &&
    parseMode !== "MarkdownV2" &&
    parseMode !== "HTML"
  ) {
    throw new Error("Telegram parseMode must be MarkdownV2, HTML or none.");
  }
  if (input.disableNotification !== undefined && typeof input.disableNotification !== "boolean") {
    throw new Error("Telegram disableNotification must be a boolean.");
  }
  const truncated = text.slice(0, 4095).replace(/[\uD800-\uDBFF]$/, "") + "…";
  return post(config, "sendMessage", {
    chat_id: chatId,
    text: text.length > 4096 ? truncated : text,
    ...(parseMode && parseMode !== "none" ? { parse_mode: parseMode } : {}),
    ...(input.disableNotification !== undefined
      ? { disable_notification: input.disableNotification }
      : {}),
  });
}
