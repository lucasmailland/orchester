"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Input, Textarea } from "@heroui/react";
import { ArrowRight } from "lucide-react";
import { notify } from "@/lib/toast";

interface Props {
  onCreated: (agent: { id: string; name: string; model: string; systemPrompt: string }) => void;
}

type TemplateId = "tier1" | "helpdesk" | "sales-coach" | "blank";

interface Template {
  id: TemplateId;
  labelKey: string;
  hintKey: string;
  defaultName: string;
  defaultRole: string;
  systemPrompt: string;
}

const TEMPLATES: Template[] = [
  {
    id: "tier1",
    labelKey: "templates.tier1.label",
    hintKey: "templates.tier1.hint",
    defaultName: "Support Tier 1",
    defaultRole: "First-line customer support",
    systemPrompt:
      "You are a tier-1 customer support agent. Answer politely and concisely. If a question is outside your knowledge, escalate to a human.",
  },
  {
    id: "helpdesk",
    labelKey: "templates.helpdesk.label",
    hintKey: "templates.helpdesk.hint",
    defaultName: "Internal Helpdesk",
    defaultRole: "Internal helpdesk for employees",
    systemPrompt:
      "You are an internal helpdesk assistant. Help employees with IT, HR, and operational questions using approved knowledge sources.",
  },
  {
    id: "sales-coach",
    labelKey: "templates.salesCoach.label",
    hintKey: "templates.salesCoach.hint",
    defaultName: "Sales Coach",
    defaultRole: "Sales coaching assistant",
    systemPrompt:
      "You are a sales coaching assistant. Review call notes, propose next steps, and suggest objection handling.",
  },
  {
    id: "blank",
    labelKey: "templates.blank.label",
    hintKey: "templates.blank.hint",
    defaultName: "",
    defaultRole: "",
    systemPrompt: "You are a helpful assistant.",
  },
];

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4", label: "Claude Haiku 4" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
];

/**
 * Step 3 — Create your first agent.
 *
 * Submits to the existing `POST /api/agents` endpoint. On success the parent
 * receives `{ id, name, model, systemPrompt }` so step 4 can wire up the
 * test-chat panel without re-fetching.
 */
export function AgentStep({ onCreated }: Props) {
  const t = useTranslations("compass.onboarding.agent");
  const [selectedTpl, setSelectedTpl] = useState<TemplateId>("tier1");
  const [model, setModel] = useState(MODELS[0]!.id);
  const [name, setName] = useState(TEMPLATES[0]!.defaultName);
  const [role, setRole] = useState(TEMPLATES[0]!.defaultRole);
  const [submitting, setSubmitting] = useState(false);

  function applyTemplate(id: TemplateId) {
    const tpl = TEMPLATES.find((x) => x.id === id);
    if (!tpl) return;
    setSelectedTpl(id);
    setName(tpl.defaultName);
    setRole(tpl.defaultRole);
  }

  // Form submit handler — typed via React's prop inference at the call site
  // (using `FormEvent` directly is flagged deprecated in @types/react@19).
  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim() || !role.trim()) {
      notify.error(t("errorMissing"));
      return;
    }
    setSubmitting(true);
    try {
      const tpl = TEMPLATES.find((x) => x.id === selectedTpl)!;
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          role: role.trim(),
          systemPrompt: tpl.systemPrompt,
          model,
          status: "active",
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        notify.error(data.error ?? t("errorFallback"));
        return;
      }
      const created = (await res.json()) as { id: string };
      onCreated({
        id: created.id,
        name: name.trim(),
        model,
        systemPrompt: tpl.systemPrompt,
      });
    } catch {
      notify.error(t("errorNetwork"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="onboarding-agent-heading" className="flex flex-col gap-6">
      <header className="space-y-2">
        <h1 id="onboarding-agent-heading" className="text-2xl font-semibold text-text-strong">
          {t("heading")}
        </h1>
        <p className="text-sm leading-relaxed text-text-muted">{t("subhead")}</p>
      </header>

      <form id="onboarding-form" onSubmit={handleSubmit} className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text-strong">
            {t("templateLabel")}
          </legend>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            {TEMPLATES.map((tpl) => {
              const isSelected = selectedTpl === tpl.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => applyTemplate(tpl.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    isSelected
                      ? "border-violet-600 bg-violet-600/5"
                      : "border-line bg-card hover:border-violet-600/40"
                  }`}
                >
                  <div className="text-sm font-medium text-text-strong">{t(tpl.labelKey)}</div>
                  <div className="text-xs text-text-muted">{t(tpl.hintKey)}</div>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div>
          <label htmlFor="agent-name" className="mb-1.5 block text-sm font-medium text-text-strong">
            {t("nameLabel")}
          </label>
          <Input
            id="agent-name"
            value={name}
            onValueChange={setName}
            placeholder={t("namePlaceholder")}
            isRequired
          />
        </div>

        <div>
          <label htmlFor="agent-role" className="mb-1.5 block text-sm font-medium text-text-strong">
            {t("roleLabel")}
          </label>
          <Textarea
            id="agent-role"
            value={role}
            onValueChange={setRole}
            placeholder={t("rolePlaceholder")}
            minRows={2}
            maxRows={3}
            isRequired
          />
        </div>

        <div>
          <label
            htmlFor="agent-model"
            className="mb-1.5 block text-sm font-medium text-text-strong"
          >
            {t("modelLabel")}
          </label>
          <select
            id="agent-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-text-strong focus:border-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-600/30"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <Button
          type="submit"
          color="primary"
          size="lg"
          endContent={<ArrowRight size={16} />}
          isLoading={submitting}
          isDisabled={submitting}
          className="w-full bg-violet-600 font-semibold"
        >
          {t("cta")}
        </Button>
      </form>
    </section>
  );
}
