// apps/web/lib/curation/group-conflicts.ts
//
// Pure helpers over the conflict-pair list from client.judge() (no SDK, no
// React) so they are unit-testable. Two jobs:
//   1. groupConflictsBySubject — bucket pairs whose facts share a subject,
//      so the resolver can show "3 conflicts about <subject>".
//   2. conflictRelationIds — the set of relationIds, used to highlight the
//      matching conflicts_with edges in the graph.
import type { ConflictPair } from "@mnemo-ai/client-ts";

export interface ConflictGroup {
  /** Lower-cased shared subject, or "" when factA/factB subjects differ. */
  subject: string;
  pairs: ConflictPair[];
}

/**
 * Group pairs by the subject they share. A pair lands under its common
 * subject (case-insensitive); pairs whose two facts disagree on subject
 * go under "" (ungrouped). Groups are sorted by descending pair count,
 * then subject asc; pairs inside a group sort by descending max worth
 * (most-load-bearing conflict first).
 */
export function groupConflictsBySubject(pairs: ConflictPair[]): ConflictGroup[] {
  const byKey = new Map<string, ConflictPair[]>();
  for (const p of pairs) {
    const a = p.factA.subject.trim().toLowerCase();
    const b = p.factB.subject.trim().toLowerCase();
    const key = a && a === b ? a : "";
    const list = byKey.get(key) ?? [];
    list.push(p);
    byKey.set(key, list);
  }
  const groups: ConflictGroup[] = [];
  for (const [subject, list] of byKey) {
    list.sort(
      (x, y) => Math.max(y.factA.worth, y.factB.worth) - Math.max(x.factA.worth, x.factB.worth)
    );
    groups.push({ subject, pairs: list });
  }
  groups.sort(
    (g1, g2) => g2.pairs.length - g1.pairs.length || g1.subject.localeCompare(g2.subject)
  );
  return groups;
}

/** Set of relationIds across all pairs — used to light up graph edges. */
export function conflictRelationIds(pairs: ConflictPair[]): Set<string> {
  return new Set(pairs.map((p) => p.relationId));
}
