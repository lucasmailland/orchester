/**
 * Shell-scoped loading fallback. Because it lives below ShellLayout,
 * the sidebar/topbar chrome stays mounted and only the inner content
 * area is replaced while a child route segment is loading.
 *
 * Server Component — no client hooks needed. Generic spinner avoids
 * shipping per-route skeletons and the layout itself already conveys
 * the page chrome, so the user sees an instant navigation response
 * instead of waiting for the server roundtrip.
 */
export default function ShellLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <svg
        className="h-7 w-7 animate-spin text-violet-500"
        viewBox="0 0 24 24"
        fill="none"
        role="status"
        aria-label="Loading"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    </div>
  );
}
