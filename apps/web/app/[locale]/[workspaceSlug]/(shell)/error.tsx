"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { RotateCcw, ArrowRight } from "lucide-react";
import { captureException } from "@/lib/observability";

/**
 * Error boundary scoped to the shell. Because it lives below ShellLayout,
 * the sidebar/topbar chrome stays mounted and only the inner content area
 * is replaced when a route under (shell) throws.
 */
export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors.generic");
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "es";

  useEffect(() => {
    console.error("[ShellError]", error);
    captureException(error, { tags: { boundary: "shell-error" } });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-2xl font-bold tracking-tight text-strong">{t("title")}</h1>
      <p className="mt-2 max-w-md text-sm text-muted">{t("description")}</p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all duration-200 hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-500/30 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
        >
          <RotateCcw size={15} />
          {t("retry")}
        </button>
        <a
          href={`/${locale}`}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-2.5 text-sm font-medium text-body transition-colors hover:bg-hover"
        >
          {t("backDashboard")}
          <ArrowRight size={15} />
        </a>
      </div>
    </div>
  );
}
