// apps/web/lib/curation/supersedes-dag.ts
//
// Pure: turn a flat decision list into supersedes chains. Each MnemoDecision
// has supersededById (types.ts:694) pointing at the decision that replaced it.
// We build forward chains head → … → tail where the HEAD is the newest still-
// active decision (nothing supersedes it) and each subsequent link is the one
// it superseded. No SDK, no React — unit-testable.
import type { MnemoDecision } from "@mnemo-ai/client-ts";

export interface SupersedesChain {
  /** Decisions oldest → newest is awkward for lineage; we order newest → oldest
   *  (head = current, tail = original). */
  decisions: MnemoDecision[];
}

/**
 * Build lineage chains. A decision is a CHAIN HEAD when no other decision in
 * the set has `supersededById === thisId` (i.e. nothing replaced it). From
 * each head we walk `supersededById` to append the decision it replaced,
 * until the pointer is null or dangles outside the set. Decisions never
 * reachable from any head (orphans, or members of a cycle) each become their
 * own singleton chain so nothing is dropped.
 *
 * Cycle-safe: a `seen` set bounds the walk.
 */
export function buildSupersedesChains(decisions: MnemoDecision[]): SupersedesChain[] {
  const byId = new Map(decisions.map((d) => [d.id, d]));

  // supersededById points FORWARD to the newer decision that replaced `d`.
  // A decision is "replaced" if another decision's supersededById points to it.
  const isReplaced = new Set<string>();
  for (const d of decisions) {
    if (d.supersededById && byId.has(d.supersededById)) isReplaced.add(d.id);
  }
  // Heads = decisions that are not replaced by anything in the set.
  const heads = decisions.filter((d) => !isReplaced.has(d.id));

  const chains: SupersedesChain[] = [];
  const visited = new Set<string>();

  // replacedBy: newerId → the older decision it replaced.
  // i.e. if d.supersededById === newerId, then replacedBy.get(newerId) === d
  const replacedBy = new Map<string, MnemoDecision>();
  for (const d of decisions) {
    if (d.supersededById && byId.has(d.supersededById)) {
      replacedBy.set(d.supersededById, d);
    }
  }

  for (const head of heads) {
    if (visited.has(head.id)) continue;
    const chain: MnemoDecision[] = [];
    let cur: MnemoDecision | undefined = head;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      visited.add(cur.id);
      chain.push(cur);
      cur = replacedBy.get(cur.id);
    }
    chains.push({ decisions: chain });
  }

  // Any decision not visited (part of a cycle) → singleton chain.
  for (const d of decisions) {
    if (!visited.has(d.id)) {
      visited.add(d.id);
      chains.push({ decisions: [d] });
    }
  }

  // Longest lineage first, then newest head first.
  chains.sort(
    (a, b) =>
      b.decisions.length - a.decisions.length ||
      (b.decisions[0]?.createdAt ?? "").localeCompare(a.decisions[0]?.createdAt ?? "")
  );
  return chains;
}
