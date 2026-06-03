"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Input } from "@heroui/react";
import { ArrowRight, Lock } from "lucide-react";
import { notify } from "@/lib/toast";

interface Props {
  onConnected: () => void;
}

type ProviderId = "openai" | "anthropic";

/**
 * Step 2 — Connect an AI provider.
 *
 * Slimmer variant of `AIProvidersSection` pre-filtered to OpenAI + Anthropic.
 * Hits the existing `POST /api/providers` route; on success we advance.
 */
export function ProviderStep({ onConnected }: Props) {
  const t = useTranslations("compass.onboarding.provider");
  const [selected, setSelected] = useState<ProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const providers: Array<{ id: ProviderId; name: string; placeholder: string }> = [
    { id: "anthropic", name: "Anthropic", placeholder: "sk-ant-..." },
    { id: "openai", name: "OpenAI", placeholder: "sk-..." },
  ];

  // Form submit handler — typed via React's prop inference at the call site
  // (using `FormEvent` directly is flagged deprecated in @types/react@19).
  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!apiKey.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: selected, apiKey: apiKey.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        // Error message follows Compass Voice: what - why - what to do
        notify.error(data.error ?? t("errorFallback"));
        return;
      }
      onConnected();
    } catch {
      notify.error(t("errorNetwork"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="onboarding-provider-heading" className="flex flex-col gap-6">
      <header className="space-y-2">
        <h1 id="onboarding-provider-heading" className="text-2xl font-semibold text-text-strong">
          {t("heading")}
        </h1>
        <p className="text-sm leading-relaxed text-text-muted">{t("subhead")}</p>
      </header>

      <form id="onboarding-form" onSubmit={handleSubmit} className="space-y-4">
        <div role="radiogroup" aria-label={t("providerLabel")} className="grid grid-cols-2 gap-2">
          {providers.map((p) => {
            const isSelected = selected === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelected(p.id)}
                className={`rounded-xl border p-4 text-left text-sm font-medium transition-colors ${
                  isSelected
                    ? "border-violet-600 bg-violet-600/5 text-text-strong"
                    : "border-line bg-card text-text-muted hover:border-violet-600/40"
                }`}
              >
                {p.name}
              </button>
            );
          })}
        </div>

        <div>
          <label
            htmlFor="provider-api-key"
            className="mb-1.5 block text-sm font-medium text-text-strong"
          >
            {t("apiKeyLabel")}
          </label>
          <Input
            id="provider-api-key"
            type="password"
            autoComplete="off"
            placeholder={providers.find((p) => p.id === selected)?.placeholder ?? ""}
            value={apiKey}
            onValueChange={setApiKey}
            isRequired
          />
          <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
            <Lock aria-hidden="true" size={12} /> {t("security")}
          </p>
        </div>

        <Button
          type="submit"
          color="primary"
          size="lg"
          endContent={<ArrowRight size={16} />}
          isLoading={submitting}
          isDisabled={!apiKey.trim() || submitting}
          className="w-full bg-violet-600 font-semibold"
        >
          {t("cta")}
        </Button>
      </form>
    </section>
  );
}
