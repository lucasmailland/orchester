import { describe, it, expect } from "vitest";
import type { ModelAdapter, CallParams } from "../../src/adapters/types";

describe("adapters/types", () => {
  it("ModelAdapter interface compiles + has required methods (compile-time only)", () => {
    const fake: ModelAdapter = {
      providerId: "fake",
      call: async (_p: CallParams) => ({
        content: "x",
        tokensUsed: 0,
        model: "fake",
      }),
      callBatched: async () => [],
      embed: async () => [],
      supportsPromptCaching: () => false,
      supportsJSONMode: () => false,
      supportsBatchedCompletion: () => false,
      supportsBatchedEmbedding: () => false,
      costPer1MTokens: () => ({ input: 0, output: 0 }),
      costPer1MEmbeddings: () => 0,
    };
    expect(fake.providerId).toBe("fake");
  });
});
