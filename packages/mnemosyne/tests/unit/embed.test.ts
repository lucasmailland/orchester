import { describe, it, expect, vi, beforeEach } from "vitest";
import { embedMnemo, invalidateEmbedding, type EmbedFn } from "../../src/recall/embed";

const embedRawMock = vi.fn();

// Adapter cast — the mock's runtime shape matches EmbedFn (the
// 5-positional-arg embedding function from apps/web/lib/embeddings),
// but vi.fn()'s inferred type is too loose to assign directly.
const embedFn = embedRawMock as unknown as EmbedFn;

beforeEach(() => {
  embedRawMock.mockReset();
  invalidateEmbedding("ws_test");
  invalidateEmbedding("ws_a");
  invalidateEmbedding("ws_b");
});

describe("embedMnemo", () => {
  it("returns cached vector on second call with identical input", async () => {
    embedRawMock.mockResolvedValueOnce({ vectors: [[0.1, 0.2, 0.3]] });
    const first = await embedMnemo({
      workspaceId: "ws_test",
      texts: ["hello"],
      provider: "openai",
      model: "text-embedding-3-small",
      embedFn,
    });
    const second = await embedMnemo({
      workspaceId: "ws_test",
      texts: ["hello"],
      provider: "openai",
      model: "text-embedding-3-small",
      embedFn,
    });
    expect(first[0]).toEqual([0.1, 0.2, 0.3]);
    expect(second[0]).toEqual([0.1, 0.2, 0.3]);
    expect(embedRawMock).toHaveBeenCalledTimes(1);
  });

  it("does not leak cache across workspaces", async () => {
    embedRawMock.mockResolvedValueOnce({ vectors: [[0.5]] });
    embedRawMock.mockResolvedValueOnce({ vectors: [[0.7]] });
    const wsA = await embedMnemo({
      workspaceId: "ws_a",
      texts: ["hi"],
      provider: "openai",
      model: "m",
      embedFn,
    });
    const wsB = await embedMnemo({
      workspaceId: "ws_b",
      texts: ["hi"],
      provider: "openai",
      model: "m",
      embedFn,
    });
    expect(wsA[0]).toEqual([0.5]);
    expect(wsB[0]).toEqual([0.7]);
    expect(embedRawMock).toHaveBeenCalledTimes(2);
  });
});
