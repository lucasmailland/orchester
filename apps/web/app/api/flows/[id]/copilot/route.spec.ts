import { describe, it, expect, vi, beforeEach } from "vitest";

const { buildSystemPrompt } = vi.hoisted(() => ({
  buildSystemPrompt: vi.fn(() => "SYS"),
}));

vi.mock("@/lib/flows/copilot-tools", () => ({
  buildSystemPrompt,
  COPILOT_TOOLS: [],
  buildGraphFromSpec: () => ({ nodes: [], edges: [], errors: [] }),
}));
vi.mock("@/lib/llm-call", () => ({
  llmCall: vi.fn(async () => ({ content: "ok", model: "m", tokensUsed: 1, toolCalls: [] })),
  pickAvailableModel: vi.fn(async () => ({ model: "m" })),
}));
vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: vi.fn(async () => {}) }));
vi.mock("@/lib/ai/run", () => ({ recordAiUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: vi.fn(async () => ({ workspace: { id: "ws1" } })),
  isAuthContext: () => true,
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://t/api/flows/f1/copilot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("flow copilot locale", () => {
  beforeEach(() => buildSystemPrompt.mockClear());
  it("passes the request locale to buildSystemPrompt", async () => {
    await POST(req({ prompt: "make a flow", locale: "en" }), {
      params: Promise.resolve({ id: "f1" }),
    });
    expect(buildSystemPrompt).toHaveBeenCalledWith("en");
  });
});
