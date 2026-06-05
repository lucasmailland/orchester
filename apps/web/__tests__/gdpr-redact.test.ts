import { describe, it, expect } from "vitest";
import { redactSecrets } from "@/lib/gdpr/redact";

describe("gdpr/redact — secret scrubber", () => {
  it("redacts OpenAI sk- keys in nested strings", () => {
    const input = {
      tool_response:
        'curl --header "Authorization: Bearer sk-proj-abcdef1234567890abcdef" https://api.openai.com',
    };
    const out = redactSecrets(input) as { tool_response: string };
    expect(out.tool_response).not.toContain("sk-proj-");
    expect(out.tool_response).toContain("<REDACTED>");
  });

  it("redacts Anthropic sk-ant- keys", () => {
    const out = redactSecrets({ key: "sk-ant-api03-AbCdEf123456" });
    expect(JSON.stringify(out)).not.toContain("sk-ant-");
  });

  it("redacts Google AIza- keys", () => {
    const out = redactSecrets("My key: AIzaSyB1234567890abcdefghijklmnopqrstuvwxyz");
    expect(out).not.toContain("AIza");
  });

  it("redacts Stripe sk_live_ keys", () => {
    const out = redactSecrets({ stripeKey: "sk_live_51Abcdefghijklmnopqrstuvwxyz" });
    expect(JSON.stringify(out)).not.toContain("sk_live_");
  });

  it("redacts Slack xoxb tokens", () => {
    const out = redactSecrets("xoxb-1234567890-1234567890-AbCdEfGhIjKlMnOpQrStUv");
    expect(out).not.toContain("xoxb-");
  });

  it("redacts Notion ntn_ tokens", () => {
    const out = redactSecrets({ token: "ntn_abc123def456ghi789jkl012mno345" });
    expect(JSON.stringify(out)).not.toContain("ntn_");
  });

  it("redacts GitHub PATs", () => {
    const out = redactSecrets("My PAT is ghp_AbCdEfGhIjKlMnOpQrStUv");
    expect(out).not.toContain("ghp_");
  });

  it("redacts Orchester's own ok_live_ keys", () => {
    const out = redactSecrets({ orchKey: "ok_live_AbCdEfGhIjKlMnOpQrStUv" });
    expect(JSON.stringify(out)).not.toContain("ok_live_");
  });

  it("redacts by KEY NAME even if value looks innocuous", () => {
    const out = redactSecrets({
      apiKey: "totally-not-a-key-yet-still-redacted",
      api_key: "another",
      secret: "shh",
      password: "hunter2",
      authorization: "Bearer xyz",
      bearer: "xyz",
    });
    const j = JSON.stringify(out);
    expect(j).not.toContain("totally-not");
    expect(j).not.toContain("hunter2");
    expect(j.match(/<REDACTED>/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("preserves the user's free text", () => {
    const text = "I want my data exported. My email is jane@example.com.";
    expect(redactSecrets(text)).toBe(text);
  });

  it("preserves nested user content that doesn't match a pattern", () => {
    const input = {
      messages: [
        { id: "m1", content: "Can you help me with my onboarding?", metadata: { kind: "user" } },
        { id: "m2", content: "Sure! Here are some tips...", metadata: { kind: "agent" } },
      ],
    };
    const out = redactSecrets(input) as typeof input;
    expect(out.messages[0]!.content).toBe("Can you help me with my onboarding?");
    expect(out.messages[1]!.content).toBe("Sure! Here are some tips...");
  });

  it("structural sharing — unchanged objects are returned by reference", () => {
    const inner = { foo: "bar" };
    const outer = { inner };
    const out = redactSecrets(outer);
    // No secrets anywhere ⇒ exact same object reference back.
    expect(out).toBe(outer);
  });

  it("walks arrays + nested structures", () => {
    const input = {
      conversations: [
        { id: "c1", labels: ["foo", "sk-proj-abc123def456ghi789", "baz"] },
        {
          id: "c2",
          metadata: { nested: { deeper: { key: "AIzaSyBxxx12345xxxxxxxxxxxxxxxxxxxxxxxx" } } },
        },
      ],
    };
    const out = JSON.stringify(redactSecrets(input));
    expect(out).not.toContain("sk-proj-");
    expect(out).not.toContain("AIzaSy");
    expect(out).toContain("foo");
    expect(out).toContain("baz");
  });

  it("handles null + undefined gracefully", () => {
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(undefined)).toBe(undefined);
    expect(redactSecrets({ a: null, b: undefined })).toEqual({ a: null, b: undefined });
  });
});
