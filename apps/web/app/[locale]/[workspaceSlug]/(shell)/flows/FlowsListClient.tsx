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
import { Workflow, Bot, Plus, KeyRound, BookOpenText, MoreVertical, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from "@heroui/react";

import { DeleteFlowDialog } from "@/components/flows/DeleteFlowDialog";
import { NoProviderBanner } from "@/components/common/NoProviderBanner";
import { Callout } from "@/components/compass/Callout";
import { EmptyState } from "@/components/compass/EmptyState";
import { NextStep, NextStepGroup } from "@/components/compass/NextStep";
import { PageHero } from "@/components/compass/PageHero";
import { TemplatePicker } from "@/components/compass/TemplatePicker";
import { TermDef } from "@/components/compass/TermDef";
import { TourSpot } from "@/components/compass/TourSpot";
import type { CompassTemplate, FlowTemplatePayload } from "@/lib/compass/templates";
import { groupFlowsByStatus, type FlowStatus } from "@/lib/flows/group-by-status";
import type { FlowKind } from "@/lib/flows/kind";
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
  status: FlowStatus;
  /** Optional so older callers keep working: a missing kind is a pipeline. */
  kind?: FlowKind;
  nodeCount: number;
  lastRunAt: string | null;
  /** Steps that call a model. Optional so older callers keep working. */
  aiStepCount?: number;
  /** A sub-flow call reaches AI even when this flow has none itself. */
  aiViaSubflow?: boolean;
}

const STATUS_BADGE_CLASSES: Record<FlowStatus, string> = {
  active: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  paused: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  draft: "border-line text-muted",
};

export function FlowsListClient({ flows: initialFlows }: { flows: Item[] }) {
  const router = useRouter();
  const t = useTranslations("compass.flows");
  const tb = useTranslations("pages.flows.builder");
  // Local copy so a deleted card disappears at once, without waiting for the
  // server component to re-render.
  const [flows, setFlows] = useState<Item[]>(initialFlows);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | FlowKind>("all");
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

  const visibleFlows =
    kindFilter === "all" ? flows : flows.filter((f) => (f.kind ?? "pipeline") === kindFilter);
  const kindFilters: Array<{ value: "all" | FlowKind; label: string }> = [
    { value: "all", label: t("kindFilterAll") },
    { value: "pipeline", label: t("kindFilterPipelines") },
    { value: "action", label: t("kindFilterActions") },
  ];

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
          <div className="space-y-6">
            <div role="group" aria-label={t("kindFilterLabel")} className="flex items-center gap-1">
              {kindFilters.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  aria-pressed={kindFilter === k.value}
                  onClick={() => setKindFilter(k.value)}
                  className={
                    kindFilter === k.value
                      ? "rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-700 dark:text-violet-300"
                      : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:bg-hover"
                  }
                >
                  {k.label}
                </button>
              ))}
            </div>
            {visibleFlows.length === 0 && (
              <p className="text-xs text-muted">{t("noFlowsOfKind")}</p>
            )}
            {groupFlowsByStatus(visibleFlows).map((group) => (
              <section key={group.status} aria-labelledby={`flows-${group.status}-title`}>
                <h2
                  id={`flows-${group.status}-title`}
                  className="mb-3 text-sm font-semibold text-strong"
                >
                  {t(`groups.${group.status}`, { count: group.flows.length })}
                </h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {group.flows.map((f) => (
                    <motion.div
                      key={f.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="relative"
                    >
                      <button
                        type="button"
                        onClick={() => router.push(`/${locale}/${workspaceSlug}/flows/${f.id}`)}
                        className="block w-full rounded-2xl border border-line bg-card p-4 text-left hover:border-violet-500/40"
                      >
                        <div className="mb-2 flex items-center gap-2 pr-8">
                          <Workflow className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                          <span className="truncate font-medium text-strong">{f.name}</span>
                          {f.kind === "action" ? (
                            <span
                              data-testid="flow-kind-badge"
                              className="shrink-0 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300"
                            >
                              {t("kindAction")}
                            </span>
                          ) : null}
                        </div>
                        <p className="line-clamp-2 text-xs text-muted">{f.description ?? "—"}</p>
                        {(f.aiStepCount ?? 0) > 0 || f.aiViaSubflow ? (
                          <p
                            data-testid="flow-ai-steps"
                            className="mt-2 inline-flex items-center gap-1 text-[11px] text-violet-700 dark:text-violet-300"
                          >
                            <Bot className="h-3 w-3" aria-hidden="true" />
                            {(f.aiStepCount ?? 0) > 0
                              ? t("aiSteps", { count: f.aiStepCount ?? 0 })
                              : t("aiViaSubflow")}
                          </p>
                        ) : null}
                        <div className="mt-3 flex items-center justify-between text-[10px] text-faint">
                          <span>{t("nodesLabel", { count: f.nodeCount })}</span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[f.status]}`}
                          >
                            {t(`statuses.${f.status}`)}
                          </span>
                        </div>
                      </button>
                      <Dropdown placement="bottom-end">
                        <DropdownTrigger>
                          <button
                            type="button"
                            aria-label={`${tb("flowActions")}: ${f.name}`}
                            className="absolute right-2 top-2 rounded-lg p-1.5 text-muted hover:bg-hover hover:text-strong"
                          >
                            <MoreVertical className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </DropdownTrigger>
                        <DropdownMenu aria-label={tb("flowActions")}>
                          <DropdownItem
                            key="delete"
                            color="danger"
                            className="text-danger"
                            startContent={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                            onPress={() => setDeleting(f)}
                          >
                            {tb("deleteFlow")}
                          </DropdownItem>
                        </DropdownMenu>
                      </Dropdown>
                    </motion.div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </TourSpot>
      )}

      {deleting ? (
        <DeleteFlowDialog
          open
          flowId={deleting.id}
          flowName={deleting.name}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setFlows((prev) => prev.filter((x) => x.id !== deleting.id));
            setDeleting(null);
            router.refresh();
          }}
        />
      ) : null}

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
