import { describe, it, expect } from "vitest";
import { groupConflictsBySubject, conflictRelationIds } from "@/lib/curation/group-conflicts";
import type { ConflictPair } from "@mnemo-ai/client-ts";

function pair(
  id: string,
  subjA: string,
  worthA: number,
  subjB: string,
  worthB: number
): ConflictPair {
  return {
    relationId: id,
    confidence: 0.8,
    factA: {
      id: `${id}-a`,
      subject: subjA,
      statement: "A",
      worth: worthA,
      validFrom: "",
      validTo: null,
    },
    factB: {
      id: `${id}-b`,
      subject: subjB,
      statement: "B",
      worth: worthB,
      validFrom: "",
      validTo: null,
    },
  };
}

describe("groupConflictsBySubject", () => {
  it("buckets pairs by shared (case-insensitive) subject", () => {
    const groups = groupConflictsBySubject([
      pair("r1", "Budget", 0.5, "budget", 0.9),
      pair("r2", "Budget", 0.2, "BUDGET", 0.3),
      pair("r3", "Timeline", 0.7, "Timeline", 0.1),
    ]);
    const budget = groups.find((g) => g.subject === "budget");
    expect(budget?.pairs).toHaveLength(2);
    expect(groups.find((g) => g.subject === "timeline")?.pairs).toHaveLength(1);
  });

  it("puts subject-mismatched pairs under the empty-string group", () => {
    const groups = groupConflictsBySubject([pair("r1", "X", 0.5, "Y", 0.5)]);
    expect(groups[0]!.subject).toBe("");
  });

  it("sorts groups by descending pair count", () => {
    const groups = groupConflictsBySubject([
      pair("r1", "A", 0.5, "A", 0.5),
      pair("r2", "B", 0.5, "B", 0.5),
      pair("r3", "B", 0.5, "B", 0.5),
    ]);
    expect(groups[0]!.subject).toBe("b");
  });

  it("sorts pairs within a group by descending max worth", () => {
    const groups = groupConflictsBySubject([
      pair("low", "A", 0.1, "A", 0.2),
      pair("high", "A", 0.9, "A", 0.3),
    ]);
    expect(groups[0]!.pairs[0]!.relationId).toBe("high");
  });
});

describe("conflictRelationIds", () => {
  it("returns the set of relationIds", () => {
    const set = conflictRelationIds([
      pair("r1", "A", 0.5, "A", 0.5),
      pair("r2", "B", 0.5, "B", 0.5),
    ]);
    expect([...set].sort()).toEqual(["r1", "r2"]);
  });
});
