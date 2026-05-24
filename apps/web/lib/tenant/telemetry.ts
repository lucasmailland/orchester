import "server-only";

/**
 * Lightweight in-process counters for tenant-context observability.
 *
 * Phase B uses these to verify that 99%+ of requests successfully set
 * `app.workspace_id` (the GUC RLS will key off in Phase C). The numbers
 * live in process memory — they reset on deploy, which is fine for
 * a rolling rate check exposed via the admin telemetry endpoint.
 *
 * The "missing" log line is structured JSON so it shows up cleanly in
 * Vector/Datadog/whatever you point at stdout.
 */

let setCount = 0;
let missingCount = 0;

export function recordTenantContextSet(): void {
  setCount++;
}

export function recordTenantContextMissing(route: string): void {
  missingCount++;
  // Log structured for analysis
  console.log(
    JSON.stringify({
      level: "warn",
      msg: "tenant.context.missing",
      route,
      setCount,
      missingCount,
    })
  );
}

export function snapshotCounts(): {
  set: number;
  missing: number;
  ratio: number;
} {
  const total = setCount + missingCount;
  return {
    set: setCount,
    missing: missingCount,
    ratio: total === 0 ? 0 : missingCount / total,
  };
}
