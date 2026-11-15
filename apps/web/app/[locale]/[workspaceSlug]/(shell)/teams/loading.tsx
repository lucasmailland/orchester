// Per-segment loading skeleton (PERF-5). Shown while the server component
// awaits its data, so the content area is not blank on hard navigation.
export default function Loading() {
  return (
    <div className="space-y-5 p-6" aria-busy="true" aria-live="polite">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-elevated" />
      <div className="h-4 w-72 animate-pulse rounded bg-elevated" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl border border-line bg-card" />
        ))}
      </div>
    </div>
  );
}
