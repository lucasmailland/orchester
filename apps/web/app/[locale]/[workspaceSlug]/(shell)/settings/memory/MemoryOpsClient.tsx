"use client";

/**
 * Memory Operations panel — Compass design-system showcase.
 *
 * This is the reference implementation for the Sprint 2 polish phase:
 * PageHero + TermDef + Callout + ConfirmAction + NextStep, all wired
 * to next-intl and the existing /api/mnemo/admin/* endpoints.
 *
 * Each "housekeeping task" maps 1:1 to a Mnemosyne cron. Clicking
 * "Run now" opens a ConfirmAction modal that previews scope, cost
 * estimate, time estimate and reversibility BEFORE the POST fires.
 * The endpoints already enforce admin role server-side; we mirror
 * that in the UI by disabling the actions for non-admins.
 *
 * Outcome numbers (records analyzed, changes applied) are NOT
 * fabricated: the current /api/mnemo/admin/run-* routes return
 * `{ enqueued: true, jobId }` with no per-task outcome shape, so we
 * render an em-dash for any field the backend doesn't provide.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  BrainCircuit,
  Compass as CompassIcon,
  Layers,
  Lock,
  PinIcon,
  ScanSearch,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { Button, Input, Select, SelectItem, Switch } from "@heroui/react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { Callout } from "@/components/compass/Callout";
import { ConfirmAction } from "@/components/compass/ConfirmAction";
import { NextStep, NextStepGroup } from "@/components/compass/NextStep";
import { PageHero } from "@/components/compass/PageHero";
import { TermDef } from "@/components/compass/TermDef";
import { useBrainHealthLatest } from "@/lib/hooks/use-brain-health";
import { notify } from "@/lib/toast";

// ---- task definitions ------------------------------------------------------

/**
 * Stable i18n keys for the 7 housekeeping tasks. Each maps to:
 *   - a `compass.memoryOps.tasks.<key>` translation block
 *   - an existing /api/mnemo/admin/run-* endpoint (or `null` for the
 *     per-agent summary refresh, which is surfaced as a Callout)
 *
 * Reversibility, time estimate and cost estimate are intrinsic to the
 * task (not user-tunable), so they live here as constants rather than
 * in i18n. The translation strings are still localized via the
 * `reversibilityKey` reference.
 */
type TaskKey =
  | "healthSnapshot"
  | "dedup"
  | "prune"
  | "remConsolidation"
  | "reviewSweep"
  | "autoPin"
  | "summaryRefresh";

interface TaskDef {
  key: TaskKey;
  endpoint: string | null;
  icon: typeof Activity;
  tone: "neutral" | "destructive";
  reversibilityKey: "reversibilityReversible" | "reversibilityArchive" | "reversibilityDestructive";
  /** Static, human-readable time estimate. Kept short and locale-neutral. */
  estimatedTime: string;
  /** Static, human-readable cost estimate. */
  estimatedCost: string;
  /** When true, the card renders a Callout instead of a "Run now" button. */
  perAgent?: boolean;
}

const TASKS: readonly TaskDef[] = [
  {
    key: "healthSnapshot",
    endpoint: "/api/mnemo/admin/run-health",
    icon: Activity,
    tone: "neutral",
    reversibilityKey: "reversibilityReversible",
    estimatedTime: "~15s",
    estimatedCost: "$0.00",
  },
  {
    key: "dedup",
    endpoint: "/api/mnemo/admin/run-dedup",
    icon: Layers,
    tone: "neutral",
    reversibilityKey: "reversibilityReversible",
    estimatedTime: "~2m",
    estimatedCost: "$0.01 – $0.05",
  },
  {
    key: "prune",
    endpoint: "/api/mnemo/admin/run-prune",
    icon: Trash2,
    tone: "destructive",
    reversibilityKey: "reversibilityArchive",
    estimatedTime: "~1m",
    estimatedCost: "$0.00",
  },
  {
    key: "remConsolidation",
    endpoint: "/api/mnemo/admin/run-consolidation",
    icon: BrainCircuit,
    tone: "neutral",
    reversibilityKey: "reversibilityReversible",
    estimatedTime: "~3m",
    estimatedCost: "$0.05 – $0.20",
  },
  {
    key: "reviewSweep",
    endpoint: "/api/mnemo/admin/run-review-sweep",
    icon: ScanSearch,
    tone: "neutral",
    reversibilityKey: "reversibilityReversible",
    estimatedTime: "~1m",
    estimatedCost: "$0.00",
  },
  {
    key: "autoPin",
    endpoint: "/api/mnemo/admin/run-auto-pin",
    icon: PinIcon,
    tone: "neutral",
    reversibilityKey: "reversibilityReversible",
    estimatedTime: "~30s",
    estimatedCost: "$0.00",
  },
  {
    key: "summaryRefresh",
    endpoint: null,
    icon: Sparkles,
    tone: "neutral",
    reversibilityKey: "reversibilityReversible",
    estimatedTime: "~2m",
    estimatedCost: "$0.02 – $0.10",
    perAgent: true,
  },
] as const;

// ---- component -------------------------------------------------------------

interface Props {
  workspace: { id: string; slug: string; name: string };
  isAdmin: boolean;
}

export function MemoryOpsClient({ workspace, isAdmin }: Props): ReactNode {
  const t = useTranslations("compass.memoryOps");
  const tCommon = useTranslations("compass.common");
  const locale = useLocale();
  const { snapshot } = useBrainHealthLatest();

  const [pendingKey, setPendingKey] = useState<TaskKey | null>(null);
  const [confirmTask, setConfirmTask] = useState<TaskDef | null>(null);

  const healthLastRun = readSnapshotAt(snapshot);

  async function runTask(task: TaskDef): Promise<void> {
    if (!task.endpoint) return;
    setPendingKey(task.key);
    try {
      const res = await fetch(task.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: "{}",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      // The endpoint only returns { enqueued, jobId } — no outcome
      // numbers, so the toast tells the user the job is running and
      // not "47 records analyzed" (which we don't actually know).
      const name = t(`tasks.${task.key}.name`);
      notify.success(t("successToastTitle", { name }), {
        description: t("successToastBody"),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      const name = t(`tasks.${task.key}.name`);
      notify.error(t("errorToastTitle", { name }), {
        description: t("errorToastBody", { message }),
      });
    } finally {
      setPendingKey(null);
      setConfirmTask(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHero
        icon={<CompassIcon />}
        title={t("pageTitle")}
        subtitle={
          // The subtitle string mentions "Mnemosyne" as a bare word —
          // we post-wrap it with TermDef so the term gets a definition
          // tooltip without forcing translators to learn ICU markup.
          <>{wrapTermsInline(t("pageSubtitle"))}</>
        }
        tourId="memory-ops"
        tourLabel={t("tourLabel")}
      />

      {!isAdmin ? (
        <Callout variant="note" icon={Lock}>
          {t("adminOnly")}
        </Callout>
      ) : null}

      <ul className="grid gap-4 md:grid-cols-2" aria-label={t("pageTitle")}>
        {TASKS.map((task) => (
          <TaskCard
            key={task.key}
            task={task}
            isAdmin={isAdmin}
            pending={pendingKey === task.key}
            anyPending={pendingKey !== null}
            lastRunIso={task.key === "healthSnapshot" ? healthLastRun : null}
            locale={locale}
            onRequestRun={() => setConfirmTask(task)}
            workspaceSlug={workspace.slug}
          />
        ))}
      </ul>

      <section
        aria-labelledby="memory-ops-next-steps"
        className="space-y-3 border-t border-line pt-8"
      >
        <h2
          id="memory-ops-next-steps"
          className="text-sm font-semibold uppercase tracking-wide text-muted"
        >
          {t("nextStepsTitle")}
        </h2>
        <NextStepGroup className="lg:grid-cols-2">
          <NextStep
            icon={<BrainCircuit className="h-4 w-4" />}
            href={`/${locale}/${workspace.slug}/brain`}
            title={t("nextSteps.openBrain.title")}
            body={t("nextSteps.openBrain.body")}
          />
          <NextStep
            icon={<ScanSearch className="h-4 w-4" />}
            href={`/${locale}/${workspace.slug}/settings`}
            title={t("nextSteps.reviewPolicy.title")}
            body={t("nextSteps.reviewPolicy.body")}
          />
        </NextStepGroup>
      </section>

      <RecallQualitySection isAdmin={isAdmin} />

      <ConfirmAction
        open={confirmTask !== null}
        onClose={() => {
          if (pendingKey !== null) return;
          setConfirmTask(null);
        }}
        title={
          confirmTask
            ? t("confirmDialogTitle", {
                name: t(`tasks.${confirmTask.key}.name`),
              })
            : ""
        }
        description={confirmTask ? t("confirmDialogDescription") : undefined}
        action={confirmTask ? t(`tasks.${confirmTask.key}.confirmLabel`) : ""}
        cancelLabel={tCommon("cancel")}
        tone={confirmTask?.tone ?? "neutral"}
        isPending={pendingKey !== null && confirmTask?.key === pendingKey}
        impact={
          confirmTask
            ? [
                {
                  label: t("impactScopeLabel"),
                  value: workspace.name,
                },
                {
                  label: t("impactRecordsLabel"),
                  value: t("estimateUnavailable"),
                },
                {
                  label: t("impactCostLabel"),
                  value: confirmTask.estimatedCost,
                },
                {
                  label: t("impactTimeLabel"),
                  value: confirmTask.estimatedTime,
                },
                {
                  label: t("impactReversibilityLabel"),
                  value: t(confirmTask.reversibilityKey),
                },
              ]
            : []
        }
        onConfirm={() => {
          if (confirmTask) return runTask(confirmTask);
        }}
      />
    </div>
  );
}

// ---- task card -------------------------------------------------------------

interface TaskCardProps {
  task: TaskDef;
  isAdmin: boolean;
  pending: boolean;
  anyPending: boolean;
  lastRunIso: string | Date | null;
  locale: string;
  workspaceSlug: string;
  onRequestRun: () => void;
}

function TaskCard({
  task,
  isAdmin,
  pending,
  anyPending,
  lastRunIso,
  locale,
  workspaceSlug,
  onRequestRun,
}: TaskCardProps): ReactNode {
  const t = useTranslations("compass.memoryOps");
  const tTask = useTranslations(`compass.memoryOps.tasks.${task.key}`);
  const tCommon = useTranslations("compass.common");
  const Icon = task.icon;

  const headingId = `task-${task.key}-heading`;

  // The description in i18n may contain bare jargon ("Mnemosyne",
  // "cosine", etc). We post-wrap a small allowlist of terms inline
  // with TermDef so users get a hover definition without forcing the
  // translators to learn ICU markup.
  const description = wrapTermsInline(tTask("description"));
  const whyMatters = wrapTermsInline(tTask("whyMatters"));

  const lastRunLabel = (() => {
    if (!lastRunIso) return t("neverRun");
    try {
      const d = lastRunIso instanceof Date ? lastRunIso : new Date(lastRunIso);
      return new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
    } catch {
      return t("neverRun");
    }
  })();

  return (
    <li
      className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-5"
      aria-labelledby={headingId}
    >
      <header className="flex items-start gap-3">
        <div className="rounded-xl border border-line bg-elevated p-2.5">
          <Icon className="h-4 w-4 text-violet-500" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-sm font-semibold leading-tight text-strong">
            {tTask("name")}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{description}</p>
        </div>
      </header>

      <Callout variant="tip" title={t("whyMattersLabel")}>
        {whyMatters}
      </Callout>

      {task.perAgent ? (
        <Callout variant="note" title={t("summaryAgentCallout.title")}>
          <p>{t("summaryAgentCallout.body")}</p>
          <p className="mt-2">
            <Link
              href={`/${locale}/${workspaceSlug}/agents`}
              className="text-violet-600 hover:text-violet-700 dark:text-violet-400"
            >
              {t("summaryAgentCallout.linkLabel")}
            </Link>
          </p>
        </Callout>
      ) : null}

      <footer className="mt-auto flex items-center justify-between gap-3 border-t border-line/60 pt-3">
        <dl className="min-w-0 text-xs text-muted">
          <dt className="sr-only">{t("lastRunLabel")}</dt>
          <dd>
            <span className="text-faint">{t("lastRunLabel")}:</span>{" "}
            <span className="text-body">{lastRunLabel}</span>
            {task.key === "healthSnapshot" ? null : (
              <>
                {" · "}
                <span className="text-faint">{t("outcomeUnknown")}</span>
              </>
            )}
          </dd>
        </dl>
        {task.perAgent ? null : (
          <Button
            size="sm"
            variant="flat"
            color="primary"
            isDisabled={!isAdmin || (anyPending && !pending)}
            isLoading={pending}
            onPress={onRequestRun}
          >
            {tCommon("runNow")}
          </Button>
        )}
      </footer>
    </li>
  );
}

// ---- jargon wrapping -------------------------------------------------------

/**
 * Allowlist of jargon → TermDef key. The dictionary lives in
 * `lib/compass/terms.ts`; if a key here isn't in COMPASS_TERMS the
 * TermDef component will fail at compile time (the key is typed).
 *
 * Match is case-insensitive but preserves the original casing in the
 * rendered text. Multi-word terms must be added longest-first so that
 * e.g. "human review" doesn't get matched as "review".
 */
const JARGON: ReadonlyArray<{
  pattern: RegExp;
  term: "mnemosyne" | "embedding" | "cosine" | "rem" | "recall" | "fact" | "brain";
}> = [
  { pattern: /\bMnemosyne\b/gi, term: "mnemosyne" },
  { pattern: /\bembeddings?\b/gi, term: "embedding" },
  { pattern: /\bcosine\b/gi, term: "cosine" },
  { pattern: /\bREM\b/g, term: "rem" },
  { pattern: /\bBrain\b/g, term: "brain" },
];

function wrapTermsInline(text: string): ReactNode[] {
  // Run through each JARGON entry in order, splitting the string at
  // matches and substituting <TermDef>. Returns a ReactNode array.
  let nodes: Array<string | ReactNode> = [text];
  for (const { pattern, term } of JARGON) {
    const next: Array<string | ReactNode> = [];
    for (const node of nodes) {
      if (typeof node !== "string") {
        next.push(node);
        continue;
      }
      const parts = node.split(pattern);
      const matches = node.match(pattern) ?? [];
      parts.forEach((part, i) => {
        if (part) next.push(part);
        if (i < matches.length) {
          next.push(
            <TermDef key={`${term}-${next.length}`} term={term}>
              {matches[i]}
            </TermDef>
          );
        }
      });
    }
    nodes = next;
  }
  return nodes.map((node, i) =>
    typeof node === "string" ? <span key={`t-${i}`}>{node}</span> : node
  );
}

// ---- helpers ---------------------------------------------------------------

/**
 * Defensive read of the `snapshot_at` / `capturedAt` field. The shape
 * has drifted across mnemo_health revisions, so we accept all known
 * key names and return the first one we find.
 */
function readSnapshotAt(snapshot: unknown): string | Date | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const obj = snapshot as Record<string, unknown>;
  const v = obj["snapshotAt"] ?? obj["snapshot_at"] ?? obj["capturedAt"] ?? obj["captured_at"];
  if (typeof v === "string" || v instanceof Date) return v;
  return null;
}

// ---- recall quality (preserved from v1.6) ----------------------------------

interface RecallSettingsState {
  disableHyde: boolean;
  disableRerank: boolean;
  disableGraph: boolean;
  premiumEmbeddingProvider: "openai" | "voyage" | "cohere" | null;
  premiumEmbeddingModel: string | null;
}

const DEFAULT_RECALL_SETTINGS: RecallSettingsState = {
  disableHyde: false,
  disableRerank: false,
  disableGraph: false,
  premiumEmbeddingProvider: null,
  premiumEmbeddingModel: null,
};

/**
 * v1.6 recall-quality kill-switches + premium embedding selector.
 *
 * Compass treatment: all strings flow through next-intl under
 * `compass.memoryOps.recall.*`, jargon (HyDE, embedding) is wrapped
 * with TermDef, and a first-render tip nudges the user about when
 * changes apply. Data shape and PATCH/GET endpoints unchanged.
 */
function RecallQualitySection({ isAdmin }: { isAdmin: boolean }): ReactNode {
  const t = useTranslations("compass.memoryOps.recall");
  const [settings, setSettings] = useState<RecallSettingsState>(DEFAULT_RECALL_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/mnemo/settings", { method: "GET" });
        if (!res.ok) return;
        const j = (await res.json()) as RecallSettingsState;
        if (cancelled) return;
        setSettings({
          disableHyde: Boolean(j.disableHyde),
          disableRerank: Boolean(j.disableRerank),
          disableGraph: Boolean(j.disableGraph),
          premiumEmbeddingProvider: j.premiumEmbeddingProvider ?? null,
          premiumEmbeddingModel: j.premiumEmbeddingModel ?? null,
        });
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function patch(body: Partial<RecallSettingsState>): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch("/api/mnemo/settings", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as RecallSettingsState;
      setSettings({
        disableHyde: Boolean(updated.disableHyde),
        disableRerank: Boolean(updated.disableRerank),
        disableGraph: Boolean(updated.disableGraph),
        premiumEmbeddingProvider: updated.premiumEmbeddingProvider ?? null,
        premiumEmbeddingModel: updated.premiumEmbeddingModel ?? null,
      });
      notify.success(t("savedToast"));
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      notify.error(t("saveErrorToast", { message }));
    } finally {
      setSaving(false);
    }
  }

  const disabled = !isAdmin || !loaded || saving;

  const modelPlaceholder =
    settings.premiumEmbeddingProvider === "openai"
      ? t("premium.modelPlaceholderOpenai")
      : settings.premiumEmbeddingProvider === "voyage"
        ? t("premium.modelPlaceholderVoyage")
        : settings.premiumEmbeddingProvider === "cohere"
          ? t("premium.modelPlaceholderCohere")
          : t("premium.modelPlaceholderEmpty");

  return (
    <section className="space-y-3 border-t border-line pt-8">
      <header className="flex items-start gap-3">
        <div className="rounded-lg bg-emerald-500/10 p-2">
          <Zap className="h-4 w-4 text-emerald-500" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight text-strong">
            {t("title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{t("subtitle")}</p>
        </div>
      </header>

      <Callout variant="tip">{t("tip")}</Callout>

      <div className="space-y-2">
        <ToggleRow
          label={
            <>
              <TermDef term="embedding">{t("hyde.label")}</TermDef>
            </>
          }
          ariaLabel={t("hyde.label")}
          help={t("hyde.help")}
          enabled={!settings.disableHyde}
          disabled={disabled}
          onChange={(on) => patch({ disableHyde: !on })}
        />
        <ToggleRow
          label={t("rerank.label")}
          ariaLabel={t("rerank.label")}
          help={t("rerank.help")}
          enabled={!settings.disableRerank}
          disabled={disabled}
          onChange={(on) => patch({ disableRerank: !on })}
        />
        <ToggleRow
          label={t("graph.label")}
          ariaLabel={t("graph.label")}
          help={t("graph.help")}
          enabled={!settings.disableGraph}
          disabled={disabled}
          onChange={(on) => patch({ disableGraph: !on })}
        />
      </div>

      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-strong">
            <TermDef term="embedding">{t("premium.title")}</TermDef>
          </h3>
          <p className="text-xs text-muted">{t("premium.body")}</p>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {mounted ? (
            <Select
              size="sm"
              aria-label={t("premium.providerLabel")}
              label={t("premium.providerLabel")}
              placeholder={t("premium.providerPlaceholder")}
              isDisabled={disabled}
              selectedKeys={
                settings.premiumEmbeddingProvider ? [settings.premiumEmbeddingProvider] : []
              }
              onSelectionChange={(keys) => {
                const v = Array.from(keys as Set<string>)[0];
                const next = v === "openai" || v === "voyage" || v === "cohere" ? v : null;
                patch({ premiumEmbeddingProvider: next });
              }}
            >
              <SelectItem key="">{t("premium.providerDefault")}</SelectItem>
              <SelectItem key="openai">{t("premium.providerOpenai")}</SelectItem>
              <SelectItem key="voyage">{t("premium.providerVoyage")}</SelectItem>
              <SelectItem key="cohere">{t("premium.providerCohere")}</SelectItem>
            </Select>
          ) : (
            <div className="h-14 rounded-md bg-elevated" aria-hidden />
          )}
          <Input
            size="sm"
            aria-label={t("premium.modelLabel")}
            label={t("premium.modelLabel")}
            placeholder={modelPlaceholder}
            isDisabled={disabled || !settings.premiumEmbeddingProvider}
            value={settings.premiumEmbeddingModel ?? ""}
            onValueChange={(v) => {
              setSettings((s) => ({ ...s, premiumEmbeddingModel: v }));
            }}
            onBlur={() => {
              patch({
                premiumEmbeddingModel: settings.premiumEmbeddingModel || null,
              });
            }}
          />
        </div>
      </div>
    </section>
  );
}

interface ToggleRowProps {
  label: ReactNode;
  /** Plain-text label used for the Switch aria-label and the toggle container. */
  ariaLabel: string;
  help: string;
  enabled: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({
  label,
  ariaLabel,
  help,
  enabled,
  disabled,
  onChange,
}: ToggleRowProps): ReactNode {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-strong">{label}</p>
        <p className="mt-0.5 text-xs text-muted">{help}</p>
      </div>
      <Switch
        isSelected={enabled}
        onValueChange={onChange}
        isDisabled={disabled}
        aria-label={ariaLabel}
      />
    </div>
  );
}
