import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture sendEmail calls.
const sendEmail = vi.fn(async () => undefined);
vi.mock("@/lib/email", () => ({ sendEmail }));

import { NODE_HANDLERS } from "@/lib/flows/handlers";

beforeEach(() => sendEmail.mockClear());

function ctx() {
  return {
    cfg: {} as Record<string, unknown>,
    ctx: { variables: { who: "ada@example.com" } as Record<string, unknown> },
    workspaceId: "ws1",
    helpers: { setOutput: vi.fn() },
  };
}

describe("notify node really sends (ORCH-10)", () => {
  it("sends an email when channel=email", async () => {
    const c = ctx();
    c.cfg = { channel: "email", to: "{{who}}", message: "Run finished" };
    await NODE_HANDLERS.notify(c as never);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ada@example.com",
        text: expect.stringContaining("Run finished"),
      })
    );
  });

  it("throws on an unsupported channel instead of silently echoing", async () => {
    const c = ctx();
    c.cfg = { channel: "carrier-pigeon", to: "x", message: "hi" };
    await expect(NODE_HANDLERS.notify(c as never)).rejects.toThrow(/channel|soport|support/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
