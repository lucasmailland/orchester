"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { ArrowRight } from "lucide-react";

/**
 * 404 for the localized segment. Client component so we can resolve the
 * active locale for the dashboard link and pull strings from next-intl.
 */
export default function LocaleNotFound() {
  const t = useTranslations("errors.notFound");
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "es";

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-6xl font-bold tracking-tight text-gradient">
        {t("code")}
      </p>
      <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-strong">
        {t("title")}
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted">{t("description")}</p>

      <a
        href={`/${locale}`}
        className="mt-7 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all duration-200 hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-500/30 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
      >
        {t("backDashboard")}
        <ArrowRight size={15} />
      </a>
    </div>
  );
}
