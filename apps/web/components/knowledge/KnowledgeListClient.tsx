"use client";

/**
 * Knowledge bases list — Compass-polished view.
 *
 * Wraps the knowledge-base index in the Compass design system: a PageHero
 * frames the page with TermDef tooltips for "embeddings" and "RAG", a
 * Callout teaches first-time users where to start, the EmptyState replaces
 * the curt "No knowledge bases yet" card, and a NextStep row at the bottom
 * suggests adjacent setup tasks (upload first documents, attach to an
 * agent).
 *
 * Data shape is unchanged: the server component still queries Drizzle and
 * hands us a typed list — no new endpoints. There is no destructive action
 * on this list view (delete happens inside each base's detail page), so we
 * do not wire a ConfirmAction here.
 *
 * Voice: all strings come from `compass.knowledgeBases.*` and the shared
 * `compass.empty.knowledgeBases.*` namespace, and follow the Compass Voice
 * guide (neutral Spanish with "tú", no contractions in ES, no regionalisms
 * in any language).
 */

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "framer-motion";
import { BookOpen, Plus, Sparkles, ArrowUpFromLine, Bot } from "lucide-react";
import { toast } from "sonner";
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
import type { CompassTemplate, KnowledgeTemplatePayload } from "@/lib/compass/templates";
import { useTemplateCreateFlow } from "@/lib/compass/use-template-create-flow";

interface KB {
  id: string;
  name: string;
  description: string | null;
  embeddingProvider: string;
  embeddingModel: string;
  createdAt: string;
}

export function KnowledgeListClient({ kbs }: { kbs: KB[] }) {
  const router = useRouter();
  const t = useTranslations("compass.knowledgeBases");
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "es";
  const ws = params?.workspaceSlug ?? "";
  // Shared 3-state machine via the Compass hook. Knowledge has no separate
  // "Blank" template card (every card has a payload), so picker → form is
  // always via `selectTemplate`. Form-field state lives below.
  const createFlow = useTemplateCreateFlow<KnowledgeTemplatePayload>("knowledge");
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState<"openai" | "google">("openai");
  const [chunkSize, setChunkSize] = useState<number>(800);
  const [chunkOverlap, setChunkOverlap] = useState<number>(100);
  const [embeddingModel, setEmbeddingModel] = useState<string>("text-embedding-3-small");

  function handleTemplatePick(template: CompassTemplate<KnowledgeTemplatePayload>) {
    const p = template.payload;
    setName(p.name ?? "");
    setDescription(p.description ?? "");
    setProvider((p.embeddingProvider ?? "openai") as "openai" | "google");
    setEmbeddingModel(
      p.embeddingModel ??
        (p.embeddingProvider === "google" ? "text-embedding-004" : "text-embedding-3-small")
    );
    setChunkSize(p.chunkSize ?? 800);
    setChunkOverlap(p.chunkOverlap ?? 100);
    if (template.blank) {
      createFlow.openBlankForm();
    } else {
      createFlow.selectTemplate(template);
    }
  }

  function resetForm() {
    setName("");
    setDescription("");
    setChunkSize(800);
    setChunkOverlap(100);
    setEmbeddingModel("text-embedding-3-small");
    setProvider("openai");
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/knowledge-bases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          description,
          embeddingProvider: provider,
          embeddingModel:
            embeddingModel ||
            (provider === "openai" ? "text-embedding-3-small" : "text-embedding-004"),
          chunkSize,
          chunkOverlap,
        }),
      });
      if (r.ok) {
        const j = await r.json();
        toast.success(t("created"));
        router.push(`/${locale}/${ws}/knowledge/${j.id}`);
      } else {
        toast.error(t("createError"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const heroSubtitle = (
    <>
      {t("heroSubtitlePart1")}
      <TermDef term="embedding">{t("heroSubtitleTermEmbedding")}</TermDef>
      {t("heroSubtitlePart2")}
      <TermDef term="rag">{t("heroSubtitleTermRag")}</TermDef>
      {t("heroSubtitlePart3")}
    </>
  );

  const newBaseAction = (
    <TourSpot
      tourId="knowledgeBases"
      step={2}
      titleKey="compass.tours.knowledgeBases.step2.title"
      bodyKey="compass.tours.knowledgeBases.step2.body"
    >
      <Button
        size="sm"
        radius="md"
        onPress={createFlow.openPicker}
        className="bg-gradient-to-r from-violet-600 to-blue-600 font-medium text-white shadow-lg shadow-violet-500/20"
        startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
      >
        {t("newBase")}
      </Button>
    </TourSpot>
  );

  return (
    <div className="space-y-6 p-6">
      <NoProviderBanner />

      <TourSpot
        tourId="knowledgeBases"
        step={1}
        titleKey="compass.tours.knowledgeBases.step1.title"
        bodyKey="compass.tours.knowledgeBases.step1.body"
      >
        <PageHero
          icon={<BookOpen />}
          title={t("heroTitle")}
          subtitle={heroSubtitle}
          tourId="knowledgeBases"
          tourLabel={t("tourLabel")}
          action={newBaseAction}
        />
      </TourSpot>

      {kbs.length === 0 && createFlow.phase === "hidden" ? (
        <Callout variant="tip" title={t("firstBaseTipTitle")}>
          {t("firstBaseTipBody")}
        </Callout>
      ) : null}

      {createFlow.phase === "form" ? (
        <div className="rounded-2xl border border-violet-500/30 bg-card p-4">
          <label htmlFor="kb-name-input" className="block text-sm font-semibold text-strong">
            {t("createTitle")}
          </label>
          <p className="mt-0.5 text-xs text-muted">{t("createHelp")}</p>
          <input
            id="kb-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="mt-3 w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") {
                createFlow.closeAll();
                resetForm();
              }
            }}
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("descriptionPlaceholder")}
            className="mt-2 w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="kb-embedding-select" className="text-xs font-medium text-muted">
              <TermDef term="embedding">{t("embeddingsLabel")}</TermDef>
            </label>
            <select
              id="kb-embedding-select"
              value={provider}
              onChange={(e) => setProvider(e.target.value as "openai" | "google")}
              className="rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs text-strong outline-none"
            >
              <option value="openai">OpenAI · text-embedding-3-small (1536d)</option>
              <option value="google">Google · text-embedding-004 (768d)</option>
            </select>
          </div>
          <p className="mt-2 text-xs text-muted">{t("embeddingHelp")}</p>
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
                createFlow.closeAll();
                resetForm();
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {(() => {
        const nextSteps = (
          <TourSpot
            tourId="knowledgeBases"
            step={4}
            titleKey="compass.tours.knowledgeBases.step4.title"
            bodyKey="compass.tours.knowledgeBases.step4.body"
          >
            <section aria-labelledby="kb-next-steps-title" className="pt-2">
              <h2 id="kb-next-steps-title" className="mb-3 text-sm font-semibold text-strong">
                {t("nextStepsTitle")}
              </h2>
              <NextStepGroup>
                <NextStep
                  href={`/${locale}/${ws}/knowledge`}
                  icon={<ArrowUpFromLine className="h-4 w-4" aria-hidden="true" />}
                  title={t("nextStepUploadDocs.title")}
                  body={t("nextStepUploadDocs.body")}
                />
                <NextStep
                  href={`/${locale}/${ws}/agents`}
                  icon={<Bot className="h-4 w-4" aria-hidden="true" />}
                  title={t("nextStepConnectAgent.title")}
                  body={t("nextStepConnectAgent.body")}
                />
              </NextStepGroup>
            </section>
          </TourSpot>
        );

        if (kbs.length === 0 && createFlow.phase === "hidden") {
          // SET-4: show guidance first so a fresh user sees it above the fold.
          return (
            <>
              {nextSteps}
              <EmptyStateForKnowledgeBases
                newBaseLabel={t("newBase")}
                onCreate={createFlow.openPicker}
              />
            </>
          );
        }

        return (
          <>
            <TourSpot
              tourId="knowledgeBases"
              step={3}
              titleKey="compass.tours.knowledgeBases.step3.title"
              bodyKey="compass.tours.knowledgeBases.step3.body"
            >
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {kbs.map((kb) => (
                  <motion.button
                    key={kb.id}
                    type="button"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => router.push(`/${locale}/${ws}/knowledge/${kb.id}`)}
                    aria-label={`${t("openLabel")} ${kb.name}`}
                    className="rounded-2xl border border-line bg-card p-4 text-left hover:border-violet-500/40"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                      <span className="truncate font-medium text-strong">{kb.name}</span>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted">{kb.description ?? "—"}</p>
                    <div className="mt-3 flex items-center gap-1.5 text-[10px] text-faint">
                      <Sparkles className="h-3 w-3" aria-hidden="true" />
                      <span className="text-muted">{t("providerLabel")}</span>
                      <span className="font-mono">
                        {kb.embeddingProvider}/{kb.embeddingModel}
                      </span>
                    </div>
                  </motion.button>
                ))}
              </div>
            </TourSpot>
            {nextSteps}
          </>
        );
      })()}

      <TemplatePicker
        kind="knowledge"
        isOpen={createFlow.phase === "picker"}
        onClose={createFlow.closeAll}
        onSelect={handleTemplatePick}
      />
    </div>
  );
}

/**
 * Empty state lives in its own component so we can scope a second
 * `useTranslations` call to `compass.empty.knowledgeBases` — the canonical
 * Compass namespace for empty surfaces — without clobbering the
 * `compass.knowledgeBases.*` translator used by the rest of the page.
 */
function EmptyStateForKnowledgeBases({
  newBaseLabel,
  onCreate,
}: {
  newBaseLabel: string;
  onCreate: () => void;
}) {
  const tEmpty = useTranslations("compass.empty.knowledgeBases");
  return (
    <EmptyState
      icon={<BookOpen className="h-5 w-5" />}
      title={tEmpty("title")}
      body={tEmpty("body")}
      primaryCta={{ label: newBaseLabel, onClick: onCreate }}
    />
  );
}
