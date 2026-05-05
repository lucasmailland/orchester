import "server-only";
import { decrypt } from "@/lib/encryption";

export interface TelegramCredentials {
  botToken: string;
}

export function decodeTelegramCredentials(encrypted: string | null): TelegramCredentials | null {
  if (!encrypted) return null;
  try {
    const json = decrypt(encrypted);
    return JSON.parse(json) as TelegramCredentials;
  } catch {
    return null;
  }
}

/** Send a message to a Telegram chat. */
export async function telegramSend(
  botToken: string,
  chatId: string | number,
  text: string
): Promise<void> {
  if (!text) return;
  const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Telegram sendMessage ${r.status}: ${err}`);
  }
}

/** Configure the Telegram webhook for a bot. */
export async function telegramSetWebhook(botToken: string, webhookUrl: string): Promise<void> {
  const r = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] }),
  });
  if (!r.ok) {
    throw new Error(`setWebhook ${r.status}: ${await r.text()}`);
  }
}

export async function telegramGetMe(botToken: string): Promise<{ ok: boolean; result?: { username?: string; id?: number } }> {
  const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  return r.json();
}
