import { describe, it, expect, vi, beforeEach } from "vitest";

const embedRawMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/embeddings", () => ({ embed: embedRawMock }));

import { embedMnemo, invalidateEmbedding } from "../../src/recall/embed";

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
    });
    const second = await embedMnemo({
      workspaceId: "ws_test",
      texts: ["hello"],
      provider: "openai",
      model: "text-embedding-3-small",
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
    });
    const wsB = await embedMnemo({
      workspaceId: "ws_b",
      texts: ["hi"],
      provider: "openai",
      model: "m",
    });
    expect(wsA[0]).toEqual([0.5]);
    expect(wsB[0]).toEqual([0.7]);
    expect(embedRawMock).toHaveBeenCalledTimes(2);
  });
});
