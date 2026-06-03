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
import { TermDef } from "@/components/compass/TermDef";

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
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/flows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
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
    <Button
      size="sm"
      radius="md"
      onPress={() => setCreating(true)}
      className="bg-gradient-to-r from-violet-600 to-blue-600 font-medium text-white shadow-lg shadow-violet-500/20"
      startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      {t("newFlow")}
    </Button>
  );

  return (
    <div className="space-y-6 p-6">
      <NoProviderBanner />

      <PageHero
        icon={<Workflow />}
        title={t("heroTitle")}
        subtitle={heroSubtitle}
        tourId="flows"
        tourLabel={t("tourLabel")}
        action={newFlowAction}
      />

      {flows.length === 0 && !creating ? (
        <Callout variant="tip" title={t("firstFlowTipTitle")}>
          {t("firstFlowTip")}
        </Callout>
      ) : null}

      {creating ? (
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
              if (e.key === "Escape") setCreating(false);
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
            <Button
              size="sm"
              variant="light"
              onPress={() => {
                setCreating(false);
                setName("");
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {flows.length === 0 && !creating ? (
        <EmptyStateForFlows newFlowLabel={t("newFlow")} onCreate={() => setCreating(true)} />
      ) : (
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
      )}

      <section aria-labelledby="flows-next-steps-title" className="pt-2">
        <h2 id="flows-next-steps-title" className="mb-3 text-sm font-semibold text-strong">
          {t("nextStepsTitle")}
        </h2>
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
