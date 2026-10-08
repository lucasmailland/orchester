/**
 * Dry run: execute a flow against real inputs and report what it WOULD do.
 *
 * Client-safe on purpose (no server imports): the runs panel uses it to badge
 * history rows.
 *
 * A dry run is marked in `flow_run.trigger_source`, which already travels with
 * the run through the queue and into the worker, so no column or job payload
 * had to change. The mark is a suffix on whatever source started the run
 * (`manual:u1:dry-run`), so the origin stays readable.
 */
export const DRY_RUN_SUFFIX = ":dry-run";

export function isDryRunSource(source: string | null | undefined): boolean {
  return typeof source === "string" && source.endsWith(DRY_RUN_SUFFIX);
}

export function markDryRun(source: string): string {
  return isDryRunSource(source) ? source : `${source}${DRY_RUN_SUFFIX}`;
}

/** What a simulated step reports instead of the real result. */
export interface SimulatedCall {
  dryRun: true;
  wouldCall: Record<string, unknown>;
}

export function simulated(wouldCall: Record<string, unknown>): SimulatedCall {
  return { dryRun: true, wouldCall };
}

/**
 * The URL a simulated request would hit, safe to store in run history: query
 * values and embedded credentials are masked, because tokens often travel
 * there and the history outlives the run. Keys stay visible so the report
 * still says what the call carried.
 */
export function redactUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "[unparseable url]";
  }
  u.username = "";
  u.password = "";
  const keys = [...u.searchParams.keys()];
  if (keys.length === 0) return u.toString();
  const query = keys.map((k) => `${encodeURIComponent(k)}=***`).join("&");
  return `${u.origin}${u.pathname}?${query}${u.hash ? "#…" : ""}`;
}
