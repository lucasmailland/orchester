"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { RotateCcw, ArrowRight } from "lucide-react";

/**
 * Route error boundary for the localized segment. Rendered inside the
 * NextIntlClientProvider from [locale]/layout.tsx, so next-intl hooks work.
 */
export default function LocaleError({
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
    console.error("[LocaleError]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="mb-3 text-[11px] uppercase tracking-widest text-faint">
        Orchester
      </p>
      <h1 className="font-display text-3xl font-bold tracking-tight text-strong">
        {t("title")}
      </h1>
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
