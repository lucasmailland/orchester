import type { ActivityCursor } from "./types";

/**
 * Order of the timeline: newest first, then the larger id. `at` strings have a
 * fixed format (UTC, six fractional digits), so comparing them as strings is
 * comparing them as times. Ids are compared by code unit, which for the ASCII
 * ids the app generates is the order of the `COLLATE "C"` the queries sort by;
 * the SQL and this comparator must agree or pages would skip or repeat rows.
 *
 * Negative when `a` comes before `b`.
 */
export function compareActivityDesc(a: ActivityCursor, b: ActivityCursor): number {
  if (a.at !== b.at) return a.at > b.at ? -1 : 1;
  if (a.id !== b.id) return a.id > b.id ? -1 : 1;
  return 0;
}

/**
 * Merges one page from each source into a page of the timeline.
 *
 * Each source page must hold that source's rows after the cursor, newest
 * first, at most `limit + 1` of them. The first `limit` rows of the merge are
 * then exactly the first `limit` rows of the whole timeline: none of them can
 * sit beyond its own source's first `limit`. There is a next page when the
 * merge holds more than `limit` rows; when it does not, every source returned
 * `limit` rows or fewer and so has nothing left.
 */
export function mergeActivityPages<T extends ActivityCursor>(
  pages: T[][],
  limit: number
): { rows: T[]; next: ActivityCursor | null } {
  const all = pages.flat().sort(compareActivityDesc);
  const rows = all.slice(0, limit);
  const last = rows[rows.length - 1];
  const next = all.length > limit && last ? { at: last.at, id: last.id } : null;
  return { rows, next };
}
