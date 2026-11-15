import { describe, it, expect } from "vitest";
import { buildSupersedesChains } from "@/lib/curation/supersedes-dag";
import type { MnemoDecision } from "@mnemo-ai/client-ts";

function dec(id: string, supersededById: string | null, createdAt: string): MnemoDecision {
  return {
    id,
    workspaceId: "w",
    agentId: null,
    conversationId: null,
    kind: "decision",
    title: id,
    body: "",
    topicKey: null,
    revisionCount: 0,
    normalizedHash: "",
    decidedByUserId: null,
    status: supersededById ? "superseded" : "active",
    supersededById,
    metadata: {},
    validFrom: createdAt,
    validTo: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("buildSupersedesChains", () => {
  it("links a 3-deep lineage head→…→original (newest first)", () => {
    // d1 (oldest) replaced by d2 replaced by d3 (newest, head).
    const chains = buildSupersedesChains([
      dec("d1", "d2", "2026-01-01"),
      dec("d2", "d3", "2026-02-01"),
      dec("d3", null, "2026-03-01"),
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.decisions.map((d) => d.id)).toEqual(["d3", "d2", "d1"]);
  });

  it("keeps independent decisions as separate singleton chains", () => {
    const chains = buildSupersedesChains([
      dec("a", null, "2026-01-01"),
      dec("b", null, "2026-01-02"),
    ]);
    expect(chains).toHaveLength(2);
    expect(chains.every((c) => c.decisions.length === 1)).toBe(true);
  });

  it("treats a dangling supersededById (target not in set) as a head", () => {
    const chains = buildSupersedesChains([dec("only", "missing", "2026-01-01")]);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.decisions.map((d) => d.id)).toEqual(["only"]);
  });

  it("does not infinite-loop on a cycle", () => {
    const chains = buildSupersedesChains([
      dec("x", "y", "2026-01-01"),
      dec("y", "x", "2026-01-02"),
    ]);
    // Both are 'replaced' so there is no head → each becomes a singleton.
    const ids = chains.flatMap((c) => c.decisions.map((d) => d.id)).sort();
    expect(ids).toEqual(["x", "y"]);
  });

  it("orders longest lineage first", () => {
    const chains = buildSupersedesChains([
      dec("solo", null, "2026-05-01"),
      dec("o1", "o2", "2026-01-01"),
      dec("o2", null, "2026-02-01"),
    ]);
    expect(chains[0]!.decisions.length).toBe(2);
  });
});
