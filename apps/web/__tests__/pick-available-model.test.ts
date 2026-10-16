// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { pickAvailableModel, type LlmCallParams } from "@/lib/llm-call";
import { resolveModel } from "@/lib/ai/catalog";

// The model the flow copilot and "generate prompt" use: the first provider the
// workspace has enabled, in a fixed order.

vi.mock("@orchester/db", () => ({
  getDb: vi.fn(),
  schema: { aiProviders: { workspaceId: "workspaceId", provider: "provider" } },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));

type Row = { provider: string; enabled: boolean; modelsJson?: Array<{ id: string }> };
const txWith = (rows: Row[]) =>
  ({
    select: () => ({ from: () => ({ where: async () => rows }) }),
  }) as unknown as NonNullable<LlmCallParams["tx"]>;

describe("pickAvailableModel", () => {
  it("picks Claude Sonnet on Bedrock when Bedrock is the only provider", async () => {
    const picked = await pickAvailableModel("ws", txWith([{ provider: "bedrock", enabled: true }]));
    expect(picked).toEqual({
      provider: "bedrock",
      model: "bedrock:us.anthropic.claude-sonnet-4-6",
    });
  });

  it("picks a Bedrock model that the catalog knows and llmCall can route", async () => {
    const picked = await pickAvailableModel("ws", txWith([{ provider: "bedrock", enabled: true }]));
    const resolved = resolveModel(picked!.model);
    expect(resolved?.provider.id).toBe("bedrock");
    expect(resolved?.capability).toBe("chat");
    expect(resolved?.noSampling).toBeUndefined();
  });

  it("skips a disabled Bedrock provider", async () => {
    expect(
      await pickAvailableModel("ws", txWith([{ provider: "bedrock", enabled: false }]))
    ).toBeNull();
  });

  it("still prefers the providers it picked before Bedrock", async () => {
    const picked = await pickAvailableModel(
      "ws",
      txWith([
        { provider: "bedrock", enabled: true },
        { provider: "openai", enabled: true },
      ])
    );
    expect(picked).toEqual({ provider: "openai", model: "gpt-4o-mini" });
  });

  it("returns null with no provider enabled", async () => {
    expect(await pickAvailableModel("ws", txWith([]))).toBeNull();
  });
});
