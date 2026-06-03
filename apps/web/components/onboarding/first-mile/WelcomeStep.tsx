"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";
import { ArrowRight, Sparkles } from "lucide-react";
import type { Role } from "./types";

interface Props {
  initialRole: Role | null;
  initialUseSample: boolean;
  sampleAvailable: boolean;
  onNext: (values: { role: Role; useSample: boolean }) => void;
}

/**
 * Step 1 — Welcome. Single radio question + optional sample-workspace toggle.
 */
export function WelcomeStep({ initialRole, initialUseSample, sampleAvailable, onNext }: Props) {
  const t = useTranslations("compass.onboarding.welcome");
  const [role, setRole] = useState<Role | null>(initialRole);
  const [useSample, setUseSample] = useState(initialUseSample);

  const options: Array<{ value: Role; label: string; hint: string }> = [
    {
      value: "customer-support",
      label: t("options.customerSupport.label"),
      hint: t("options.customerSupport.hint"),
    },
    {
      value: "internal-automation",
      label: t("options.internalAutomation.label"),
      hint: t("options.internalAutomation.hint"),
    },
    {
      value: "exploring",
      label: t("options.exploring.label"),
      hint: t("options.exploring.hint"),
    },
  ];

  return (
    <section aria-labelledby="onboarding-welcome-heading" className="flex flex-col gap-6">
      <header className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-violet-600">
          <Sparkles aria-hidden="true" size={14} /> {t("eyebrow")}
        </p>
        <h1 id="onboarding-welcome-heading" className="text-2xl font-semibold text-text-strong">
          {t("heading")}
        </h1>
        <p className="text-sm leading-relaxed text-text-muted">{t("subhead")}</p>
      </header>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text-strong">{t("question")}</legend>
        <div role="radiogroup" aria-required="true" className="grid gap-2">
          {options.map((opt) => {
            const selected = role === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                  selected
                    ? "border-violet-600 bg-violet-600/5"
                    : "border-line bg-card hover:border-violet-600/40"
                }`}
              >
                <input
                  type="radio"
                  name="onboarding-role"
                  value={opt.value}
                  checked={selected}
                  onChange={() => setRole(opt.value)}
                  className="mt-0.5 h-4 w-4 accent-violet-600"
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-text-strong">{opt.label}</span>
                  <span className="text-xs text-text-muted">{opt.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="rounded-xl border border-line bg-elevated/40 p-3">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={useSample && sampleAvailable}
            disabled={!sampleAvailable}
            onChange={(e) => setUseSample(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-violet-600"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-text-strong">{t("sample.label")}</span>
            <span className="text-xs text-text-muted">
              {sampleAvailable ? t("sample.hint") : t("sample.unavailable")}
            </span>
          </span>
        </label>
      </div>

      <Button
        color="primary"
        size="lg"
        endContent={<ArrowRight size={16} />}
        isDisabled={!role}
        className="bg-violet-600 font-semibold"
        onPress={() => role && onNext({ role, useSample: useSample && sampleAvailable })}
      >
        {t("cta")}
      </Button>
    </section>
  );
}
