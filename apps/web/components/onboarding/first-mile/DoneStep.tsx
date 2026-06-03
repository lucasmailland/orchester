"use client";

import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";
import { Brain, CheckCircle2, MessageSquare, Plug } from "lucide-react";
import { NextStep } from "@/components/compass/NextStep";

interface Props {
  agentName: string;
  lastMessage: string | null;
  workspaceSlug: string | null;
  locale: string;
  onOpenStudio: () => void;
}

/**
 * Step 5 — Done. Celebratory but professional card with 3 NextStep follow-ups.
 */
export function DoneStep({ agentName, lastMessage, workspaceSlug, locale, onOpenStudio }: Props) {
  const t = useTranslations("compass.onboarding.done");
  const slug = workspaceSlug ?? "";
  const base = slug ? `/${locale}/${slug}` : `/${locale}`;

  return (
    <section aria-labelledby="onboarding-done-heading" className="flex flex-col gap-6">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-violet-600/10 px-3 py-1 text-xs font-medium text-violet-600">
          <CheckCircle2 aria-hidden="true" size={14} /> {t("badge")}
        </div>
        <h1 id="onboarding-done-heading" className="text-2xl font-semibold text-text-strong">
          {t("heading")}
        </h1>
        <p className="text-sm leading-relaxed text-text-muted">{t("subhead")}</p>
      </header>

      <div className="rounded-xl border border-line bg-card p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
          {t("agentLive")}
        </p>
        <p className="mt-1 text-sm font-semibold text-text-strong">{agentName}</p>
        {lastMessage && (
          <p className="mt-2 line-clamp-3 text-sm text-text-muted">
            {t("lastMessage")}: <span className="italic">"{lastMessage}"</span>
          </p>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-text-strong">{t("nextStepsHeading")}</p>
        <div className="grid gap-3">
          <NextStep
            title={t("nextSteps.channel.title")}
            body={t("nextSteps.channel.body")}
            estimateMinutes={3}
            icon={<Plug size={16} />}
            href={`${base}/channels`}
          />
          <NextStep
            title={t("nextSteps.knowledge.title")}
            body={t("nextSteps.knowledge.body")}
            estimateMinutes={5}
            icon={<MessageSquare size={16} />}
            href={`${base}/knowledge`}
          />
          <NextStep
            title={t("nextSteps.brain.title")}
            body={t("nextSteps.brain.body")}
            estimateMinutes={2}
            icon={<Brain size={16} />}
            href={`${base}/brain`}
          />
        </div>
      </div>

      <Button
        type="button"
        color="primary"
        size="lg"
        onPress={onOpenStudio}
        className="bg-violet-600 font-semibold"
      >
        {t("cta")}
      </Button>
    </section>
  );
}
