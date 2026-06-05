"use client";

import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";
import { ShieldAlert } from "lucide-react";

interface Props {
  locale: string;
  /** Path the user should land on after re-auth (must start with "/"). */
  returnTo: string;
}

/**
 * Inline alert shown when an onboarding API call returns 401.
 *
 * Voice: amable, not casual — what failed, why, what to do next.
 * Wizard state is persisted to localStorage on every change so a re-login
 * round-trip preserves the user's progress.
 */
export function SessionExpiredAlert({ locale, returnTo }: Props) {
  const t = useTranslations("compass.onboarding.common");
  // returnTo is constructed internally (window.location.pathname) but we still
  // build a clean URL with encodeURIComponent to be safe.
  const href = `/${locale}/login?return=${encodeURIComponent(returnTo)}`;

  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
    >
      <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
      <div className="flex-1 space-y-2">
        <div className="text-sm font-medium text-text-strong">{t("sessionExpiredTitle")}</div>
        <p className="text-xs leading-relaxed text-text-muted">{t("sessionExpiredBody")}</p>
        <Button
          as="a"
          href={href}
          size="sm"
          color="primary"
          className="bg-violet-600 font-semibold"
        >
          {t("signInAgain")}
        </Button>
      </div>
    </div>
  );
}
