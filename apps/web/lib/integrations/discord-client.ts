import "server-only";

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Discord needs ${name}.`);
  return value;
}

export function discordWebhookUrl(config: Record<string, string>): URL {
  const raw = config.webhookUrl?.trim() ?? "";
  // Match the entire input before parsing, which could otherwise normalize unsafe paths.
  if (
    !/^https:\/\/(?:discord\.com|discordapp\.com)\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(
      raw
    )
  ) {
    throw new Error(
      "Invalid Discord webhook URL. Use an HTTPS Discord incoming webhook URL without query parameters."
    );
  }
  return new URL(raw);
}

/** Private POST transport; redirects must never forward a message to another host. */
async function post(
  config: Record<string, string>,
  body: Record<string, unknown>,
  threadId?: unknown
) {
  const url = discordWebhookUrl(config);
  const webhook = url.toString();
  const token = url.pathname.split("/").at(-1)!;
  const scrub = (text: string) =>
    text.split(webhook).join("[redacted]").split(token).join("[redacted]");
  if (threadId !== undefined) url.searchParams.set("thread_id", requiredText(threadId, "threadId"));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = scrub(await res.text())
        .trim()
        .slice(0, 200);
      throw new Error(`Discord HTTP ${res.status}: ${text}`);
    }
    // Incoming webhooks normally return 204, with no JSON body.
    return { ok: true, status: res.status };
  } catch (e) {
    throw new Error(scrub(e instanceof Error ? e.message : String(e)).slice(0, 240));
  } finally {
    clearTimeout(timer);
  }
}

export async function discordSendMessage(
  config: Record<string, string>,
  input: Record<string, unknown>
) {
  const content = requiredText(input.content, "content");
  // Avoid cutting a UTF-16 surrogate pair at the boundary.
  const truncated = content.slice(0, 1999).replace(/[\uD800-\uDBFF]$/, "") + "…";
  return post(
    config,
    {
      content: content.length > 2000 ? truncated : content,
      ...(input.username !== undefined
        ? { username: requiredText(input.username, "username") }
        : {}),
    },
    input.threadId
  );
}

export async function discordSendEmbed(
  config: Record<string, string>,
  input: Record<string, unknown>
) {
  const embed: Record<string, unknown> = {
    title: requiredText(input.title, "title"),
    description: requiredText(input.description, "description"),
  };
  if (input.url !== undefined) embed.url = requiredText(input.url, "url");
  if (input.color !== undefined) {
    if (
      typeof input.color !== "number" ||
      !Number.isInteger(input.color) ||
      input.color < 0 ||
      input.color > 0xffffff
    ) {
      throw new Error("Discord color must be an integer from 0 to 16777215.");
    }
    embed.color = input.color;
  }
  if (input.fields !== undefined) {
    if (!Array.isArray(input.fields)) throw new Error("Discord fields must be an array.");
    embed.fields = input.fields.map((field: unknown) => {
      if (!field || typeof field !== "object") throw new Error("Invalid Discord embed field.");
      const row = field as Record<string, unknown>;
      if (row.inline !== undefined && typeof row.inline !== "boolean")
        throw new Error("Discord inline must be a boolean.");
      return {
        name: requiredText(row.name, "field name"),
        value: requiredText(row.value, "field value"),
        ...(row.inline !== undefined ? { inline: row.inline } : {}),
      };
    });
  }
  return post(config, { embeds: [embed] });
}
