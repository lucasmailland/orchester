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
