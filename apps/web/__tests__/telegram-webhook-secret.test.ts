import { describe, expect, it } from "vitest";
import { checkWebhookSecret, newWebhookSecret } from "@/lib/channels/telegram";

/**
 * The URL secret cannot prove an update came from Telegram: a URL ends up in
 * proxy logs, browser history and screenshots, and whoever holds it can post
 * straight to the agent. Telegram echoes back the `secret_token` we registered,
 * which a leaked URL does not carry.
 */
describe("checkWebhookSecret", () => {
  const secreto = "a".repeat(48);

  it("accepts the secret it registered", () => {
    expect(checkWebhookSecret(secreto, secreto)).toBe("ok");
  });

  it("reports a missing header as a mismatch, never as unconfigured", () => {
    // This is the distinction that matters: a configured channel whose update
    // arrives with no header is an impostor, not a channel pending setup.
    expect(checkWebhookSecret(secreto, null)).toBe("mismatch");
    expect(checkWebhookSecret(secreto, "")).toBe("mismatch");
  });

  it.each([
    ["a different value of the same length", "b".repeat(48)],
    ["the right value, one char short", "a".repeat(47)],
    ["the right value plus one char", "a".repeat(49)],
    ["the right value with a space", `${"a".repeat(47)} `],
  ])("refuses %s", (_caso, header) => {
    expect(checkWebhookSecret(secreto, header)).toBe("mismatch");
  });

  it.each([
    ["undefined", undefined],
    ["empty string", ""],
  ])("reports %s as unconfigured, with or without a header", (_caso, esperado) => {
    // A channel registered before this existed. The caller has to name this
    // case to let it through, which is why the function does not return a
    // boolean: `true` here would read as "verified".
    expect(checkWebhookSecret(esperado, null)).toBe("unconfigured");
    expect(checkWebhookSecret(esperado, "cualquier cosa")).toBe("unconfigured");
  });
});

describe("newWebhookSecret", () => {
  it("only uses characters Telegram accepts in secret_token", () => {
    // Telegram documents `A-Z a-z 0-9 _ -`, 1 to 256 characters. A secret
    // outside that set is rejected by setWebhook, so the channel silently
    // keeps the old webhook.
    for (let i = 0; i < 20; i++) {
      const s = newWebhookSecret();
      expect(s).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    }
  });

  it("does not repeat", () => {
    const vistos = new Set(Array.from({ length: 50 }, () => newWebhookSecret()));
    expect(vistos.size).toBe(50);
  });

  it("is long enough not to be guessed", () => {
    expect(newWebhookSecret().length).toBeGreaterThanOrEqual(32);
  });
});
