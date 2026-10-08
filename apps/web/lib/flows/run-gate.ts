/**
 * Run gate: the one place that decides whether a flow may start.
 *
 * A flow with `enabled === false` is switched off. It still runs in two
 * explicit cases, and nowhere else:
 *   - a dry run (nothing is written), or
 *   - a manual run started by a signed-in person from the app, which is how
 *     a flow gets tested before it is enabled (`manual: true`).
 * Every automated entry point (webhooks, other flows, agent tools, MCP,
 * channels) passes neither, so it is refused.
 *
 * Both `enqueueFlowRun` and `executeFlow` call this, so no entry point can
 * skip it. The queue worker does not repeat the check at enqueue time, but it
 * re-checks when it picks the run up: a flow disabled while the run waited
 * cancels every run that was not admitted as manual or dry.
 */
export class FlowDisabledError extends Error {
  readonly flowId: string;
  constructor(flow: { id: string; name?: string | null }) {
    super(`Flow "${flow.name || flow.id}" is disabled`);
    this.name = "FlowDisabledError";
    this.flowId = flow.id;
  }
}

export function assertFlowRunnable(
  flow: { id: string; name?: string | null; enabled?: boolean | null },
  opts: { dryRun?: boolean; manual?: boolean }
): void {
  if (flow.enabled !== false) return;
  if (opts.dryRun || opts.manual) return;
  throw new FlowDisabledError(flow);
}

/**
 * Whether a run was admitted as a manual run, judged from the
 * `flow_run.trigger_source` it was queued with (`manual:<userId>`, optionally
 * followed by the dry-run mark). No column records it: the REST run route is
 * the only writer of the `manual:` prefix.
 */
export function isManualSource(source: string | null | undefined): boolean {
  return typeof source === "string" && (source === "manual" || source.startsWith("manual:"));
}
