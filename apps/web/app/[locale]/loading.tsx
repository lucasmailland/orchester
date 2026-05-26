/**
 * Route-level loading fallback for the localized segment. Centered spinner
 * matching the app accent. Server component (no client hooks needed).
 */
export default function LocaleLoading() {
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
