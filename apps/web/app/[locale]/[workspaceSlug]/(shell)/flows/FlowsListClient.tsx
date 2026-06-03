"use client";

/**
 * Flows list — Compass-polished view.
 *
 * Wraps the flows index in the Compass design system: a PageHero
 * explains what a flow is (with inline TermDef tooltips for the jargon),
 * a Callout offers a one-shot tip for first-time users, an EmptyState
 * replaces the curt "No flows yet" placeholder, and a NextStep row at
 * the bottom suggests adjacent setup tasks (connect a channel, add a
 * knowledge base).
 *
 * Data shape is unchanged: the server component still fetches rows from
 * Drizzle and hands us a typed list. We don't add endpoints here.
 *
 * Voice: all strings come from `compass.flows.*` and follow the Compass
 * Voice guide (neutral Spanish with "tú", no contractions in ES, no
 * regionalisms in any language).
 */

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "framer-motion";
import { Workflow, Plus, KeyRound, BookOpenText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";

import { NoProviderBanner } from "@/components/common/NoProviderBanner";
import { Callout } from "@/components/compass/Callout";
import { EmptyState } from "@/components/compass/EmptyState";
import { NextStep, NextStepGroup } from "@/components/compass/NextStep";
import { PageHero } from "@/components/compass/PageHero";
import { TemplatePicker } from "@/components/compass/TemplatePicker";
import { TermDef } from "@/components/compass/TermDef";
import { TourSpot } from "@/components/compass/TourSpot";
import type { CompassTemplate, FlowTemplatePayload } from "@/lib/compass/templates";
import { useTemplateCreateFlow } from "@/lib/compass/use-template-create-flow";

// Prefill captured from a TemplatePicker selection. Name + description seed
// the inline create card; the graph (nodes/edges/variables) is sent verbatim
// to `POST /api/flows` so the FlowBuilder opens with the template already
// laid out instead of an empty canvas + guided state.
interface FlowCreatePrefill {
  name: string;
  description?: string;
  nodes?: unknown[];
  edges?: unknown[];
  variables?: Record<string, unknown>;
}

interface Item {
  id: string;
  name: string;
  description: string | null;
  status: string;
  nodeCount: number;
  lastRunAt: string | null;
}

export function FlowsListClient({ flows }: { flows: Item[] }) {
  const router = useRouter();
  const t = useTranslations("compass.flows");
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "es";
  const workspaceSlug = params?.workspaceSlug ?? "";
  // Shared 3-state machine via the Compass hook (see use-template-create-flow.ts).
  // Blank short-circuits picker → form with no prefill so the historical
  // "open straight to name input" UX still works.
  const createFlow = useTemplateCreateFlow<FlowTemplatePayload>("flow");
  const [prefill, setPrefill] = useState<FlowCreatePrefill | undefined>(undefined);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleStartCreate() {
    setPrefill(undefined);
    setName("");
    createFlow.openPicker();
  }

  function handlePickTemplate(template: CompassTemplate<FlowTemplatePayload>) {
    if (template.blank) {
      // Blank skips prefill — name input starts empty and the server falls
      // through to its "empty canvas + guided state" path.
      setPrefill(undefined);
      setName("");
      createFlow.openBlankForm();
      return;
    }
    const next: FlowCreatePrefill = { name: template.payload.name };
    if (template.payload.description !== undefined) {
      next.description = template.payload.description;
    }
    if (template.payload.nodes !== undefined) next.nodes = template.payload.nodes;
    if (template.payload.edges !== undefined) next.edges = template.payload.edges;
    if (template.payload.variables !== undefined) {
      next.variables = template.payload.variables;
    }
    setPrefill(next);
    setName(next.name);
    createFlow.selectTemplate(template);
  }

  function handleCloseCreateFlow() {
    createFlow.closeAll();
    setPrefill(undefined);
    setName("");
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      // When a template was picked, we send its graph inline. The server
      // will use these only if no `templateId` resolved (which is our case
      // — the Compass registry is client-side, not in `flowTemplates`).
      const body: Record<string, unknown> = { name: trimmed };
      if (prefill?.description) body.description = prefill.description;
      if (prefill?.nodes) body.nodes = prefill.nodes;
      if (prefill?.edges) body.edges = prefill.edges;
      if (prefill?.variables) body.variables = prefill.variables;

      const r = await fetch("/api/flows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const j = await r.json();
        router.push(`/${locale}/${workspaceSlug}/flows/${j.id}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const heroSubtitle = (
    <>
      {t("heroSubtitlePart1")}
      <TermDef term="flow">{t("heroSubtitleTermFlow")}</TermDef>
      {t("heroSubtitlePart2")}
      <TermDef term="agent">{t("heroSubtitleTermAgent")}</TermDef>
      {t("heroSubtitlePart3")}
    </>
  );

  const newFlowAction = (
    <TourSpot
      tourId="flows"
      step={2}
      titleKey="compass.tours.flows.step2.title"
      bodyKey="compass.tours.flows.step2.body"
    >
      <Button
        size="sm"
        radius="md"
        onPress={handleStartCreate}
        className="bg-gradient-to-r from-violet-600 to-blue-600 font-medium text-white shadow-lg shadow-violet-500/20"
        startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
      >
        {t("newFlow")}
      </Button>
    </TourSpot>
  );

  return (
    <div className="space-y-6 p-6">
      <NoProviderBanner />

      <TourSpot
        tourId="flows"
        step={1}
        titleKey="compass.tours.flows.step1.title"
        bodyKey="compass.tours.flows.step1.body"
      >
        <PageHero
          icon={<Workflow />}
          title={t("heroTitle")}
          subtitle={heroSubtitle}
          tourId="flows"
          tourLabel={t("tourLabel")}
          action={newFlowAction}
        />
      </TourSpot>

      {flows.length === 0 && createFlow.phase === "hidden" ? (
        <Callout variant="tip" title={t("firstFlowTipTitle")}>
          {t("firstFlowTip")}
        </Callout>
      ) : null}

      {/* Step 1: pick a template (or Blank). */}
      <TemplatePicker
        kind="flow"
        isOpen={createFlow.phase === "picker"}
        onClose={createFlow.closeAll}
        onSelect={handlePickTemplate}
      />

      {createFlow.phase === "form" ? (
        <div className="rounded-2xl border border-violet-500/30 bg-card p-4">
          <label htmlFor="flows-name-input" className="block text-sm font-semibold text-strong">
            {t("createTitle")}
          </label>
          <p className="mt-0.5 text-xs text-muted">{t("createHelp")}</p>
          <input
            id="flows-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="mt-3 w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") handleCloseCreateFlow();
            }}
          />
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              onPress={create}
              isDisabled={!name.trim() || submitting}
              isLoading={submitting}
              className="bg-violet-500 text-white hover:bg-violet-400"
            >
              {t("create")}
            </Button>
            <Button size="sm" variant="light" onPress={handleCloseCreateFlow}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {flows.length === 0 && createFlow.phase === "hidden" ? (
        <EmptyStateForFlows newFlowLabel={t("newFlow")} onCreate={handleStartCreate} />
      ) : (
        <TourSpot
          tourId="flows"
          step={3}
          titleKey="compass.tours.flows.step3.title"
          bodyKey="compass.tours.flows.step3.body"
        >
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {flows.map((f) => (
              <motion.button
                key={f.id}
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => router.push(`/${locale}/${workspaceSlug}/flows/${f.id}`)}
                className="rounded-2xl border border-line bg-card p-4 text-left hover:border-violet-500/40"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  <span className="truncate font-medium text-strong">{f.name}</span>
                </div>
                <p className="line-clamp-2 text-xs text-muted">{f.description ?? "—"}</p>
                <div className="mt-3 flex items-center justify-between text-[10px] text-faint">
                  <span>{t("nodesLabel", { count: f.nodeCount })}</span>
                  <span className="uppercase tracking-wide">{f.status}</span>
                </div>
              </motion.button>
            ))}
          </div>
        </TourSpot>
      )}

      <section aria-labelledby="flows-next-steps-title" className="pt-2">
        <h2 id="flows-next-steps-title" className="mb-3 text-sm font-semibold text-strong">
          {t("nextStepsTitle")}
        </h2>
        <TourSpot
          tourId="flows"
          step={4}
          titleKey="compass.tours.flows.step4.title"
          bodyKey="compass.tours.flows.step4.body"
        >
          <NextStepGroup>
            <NextStep
              href={`/${locale}/${workspaceSlug}/channels`}
              icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
              title={t("nextStepConnectChannel.title")}
              body={t("nextStepConnectChannel.body")}
            />
            <NextStep
              href={`/${locale}/${workspaceSlug}/knowledge`}
              icon={<BookOpenText className="h-4 w-4" aria-hidden="true" />}
              title={t("nextStepAddKnowledge.title")}
              body={t("nextStepAddKnowledge.body")}
            />
          </NextStepGroup>
        </TourSpot>
      </section>
    </div>
  );
}

/**
 * Empty state lives in its own component so we can scope a second
 * `useTranslations` call to `compass.empty.flows` — the canonical
 * Compass namespace for empty surfaces — without clobbering the
 * `compass.flows.*` translator used by the rest of the page. The body
 * gets a TermDef around "flow" so the same pedagogical affordance
 * available in the hero stays available in the empty state.
 */
function EmptyStateForFlows({
  newFlowLabel,
  onCreate,
}: {
  newFlowLabel: string;
  onCreate: () => void;
}) {
  const tEmpty = useTranslations("compass.empty.flows");
  return (
    <EmptyState
      icon={<Workflow className="h-5 w-5" />}
      title={tEmpty("title")}
      body={tEmpty("body")}
      primaryCta={{ label: newFlowLabel, onClick: onCreate }}
    />
  );
}
