"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Layers,
  Lock,
  PinIcon,
  ScanSearch,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
  Select,
  SelectItem,
  Input,
} from "@heroui/react";
import { useTranslations } from "next-intl";
import { notify } from "@/lib/toast";
import { useBrainHealthLatest } from "@/lib/hooks/use-brain-health";

/**
 * Memory Operations panel — admin-only "Run now" triggers for the
 * seven Mnemosyne crons.
 *
 * Each op is a card with a short description + a "Run now" button.
 * Clicking pops a confirm modal (the operations write to mnemo_*
 * tables on the worker side; a stray click while debugging shouldn't
 * silently kick off prune). On confirm we POST to the matching
 * `/api/mnemo/admin/run-*` route and surface a toast.
 *
 * For the health op we display the most recent `mnemo_health` snapshot
 * timestamp as "Last run" — that's the only cron whose persisted shape
 * already records when it last ran. The others get an em-dash until
 * v1.6 adds per-job last-run tracking.
 *
 * Buttons are disabled (with a lock icon stub) when the caller isn't
 * an admin. The server re-enforces via `requireAuth({ minRole: 'admin' })`.
 */

type OpId = "health" | "dedup" | "prune" | "consolidation" | "review-sweep" | "auto-pin";

interface OpDef {
  id: OpId;
  endpoint: string;
  icon: typeof Activity;
}

const OPS: OpDef[] = [
  { id: "health", endpoint: "/api/mnemo/admin/run-health", icon: Activity },
  { id: "dedup", endpoint: "/api/mnemo/admin/run-dedup", icon: Layers },
  { id: "prune", endpoint: "/api/mnemo/admin/run-prune", icon: Trash2 },
  {
    id: "consolidation",
    endpoint: "/api/mnemo/admin/run-consolidation",
    icon: BrainCircuit,
  },
  {
    id: "review-sweep",
    endpoint: "/api/mnemo/admin/run-review-sweep",
    icon: ScanSearch,
  },
  { id: "auto-pin", endpoint: "/api/mnemo/admin/run-auto-pin", icon: PinIcon },
];

interface Props {
  workspace: { id: string; slug: string };
  isAdmin: boolean;
}

export function MemoryOpsClient({ isAdmin }: Props) {
  const t = useTranslations("settings.memory");
  const { snapshot } = useBrainHealthLatest();
  const [pending, setPending] = useState<OpId | null>(null);
  const [confirming, setConfirming] = useState<OpDef | null>(null);

  const healthLastRun = readSnapshotAt(snapshot);

  async function runOp(op: OpDef) {
    setPending(op.id);
    try {
      const res = await fetch(op.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      notify.success(t("toast.enqueued"));
    } catch (err) {
      notify.error(
        t("toast.enqueueError", {
          message: err instanceof Error ? err.message : "unknown",
        })
      );
    } finally {
      setPending(null);
      setConfirming(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="rounded-lg bg-violet-500/10 p-2.5">
          <Sparkles className="h-5 w-5 text-violet-500" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-strong">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
        </div>
      </header>

      {!isAdmin ? (
        <div className="flex items-start gap-3 rounded-2xl border border-line bg-card p-4 text-sm text-muted">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
          <p>{t("adminOnly")}</p>
        </div>
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2">
        {OPS.map((op) => {
          const Icon = op.icon;
          const lastRun = op.id === "health" ? healthLastRun : null;
          return (
            <li
              key={op.id}
              className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-elevated p-2">
                  <Icon className="h-4 w-4 text-violet-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-strong">{t(`ops.${op.id}.name`)}</h3>
                  <p className="mt-1 text-xs text-muted">{t(`ops.${op.id}.description`)}</p>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-line/50 pt-3 text-[11px] text-faint">
                <span>
                  {t("lastRun")}:{" "}
                  <span className="text-body">
                    {lastRun ? new Date(lastRun).toLocaleString() : "—"}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="flat"
                  color="primary"
                  isDisabled={!isAdmin || pending !== null}
                  isLoading={pending === op.id}
                  onPress={() => setConfirming(op)}
                >
                  {t("actions.runNow")}
                </Button>
              </div>
            </li>
          );
        })}
        {/* Summary refresh — needs an agentId, surfaced as a stub for v1.6
            (per the brief: the panel "renders 7 buttons" but the seventh
            operation requires an agent picker that isn't in scope here). */}
        <li className="flex flex-col gap-3 rounded-2xl border border-dashed border-line/70 bg-card/60 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-elevated p-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-strong">{t("ops.summary.name")}</h3>
              <p className="mt-1 text-xs text-muted">{t("ops.summary.description")}</p>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-line/50 pt-3 text-[11px] text-faint">
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("ops.summary.requiresAgent")}
            </span>
            <Button size="sm" variant="flat" isDisabled>
              {t("actions.runNow")}
            </Button>
          </div>
        </li>
      </ul>

      {/* v1.6 — Recall quality subsection. Defaults are ON; the three
          kill-switches let an operator opt out (e.g. on a tight budget).
          The premium-embedding selector upgrades pinned/high-conf/
          workspace-scope facts to a richer model. */}
      <RecallQualitySection isAdmin={isAdmin} />

      <ConfirmRunModal
        op={confirming}
        running={pending !== null && confirming?.id === pending}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && runOp(confirming)}
      />
    </div>
  );
}

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
 * v1.6 — Recall quality + premium embedding workspace settings.
 *
 * Three default-ON kill-switches (HyDE / rerank / graph expansion) and
 * a premium-embedding provider+model selector. Each toggle saves
 * optimistically and rolls back on PATCH failure.
 *
 * NB: strings are inline rather than via next-intl because the
 * `apps/web/messages/*.json` files are owned by G1/G2 in this v1.6
 * branch sweep (concurrent edit avoidance). The next translation pass
 * will lift these into the i18n catalog. The text is short, scoped to
 * an admin-only panel, and never user-facing in the agent runtime.
 */
function RecallQualitySection({ isAdmin }: { isAdmin: boolean }) {
  const [settings, setSettings] = useState<RecallSettingsState>(DEFAULT_RECALL_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  // HeroUI Select → React Aria useId() mismatches SSR vs the first
  // client render under Next 15 + Turbopack (same root cause we fixed
  // in FactFilters and Conversations). Render a placeholder until the
  // component has mounted client-side so the Select tree never SSRs.
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
        headers: { "content-type": "application/json", accept: "application/json" },
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
      notify.success("Saved");
    } catch (err) {
      notify.error(`Couldn't save: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setSaving(false);
    }
  }

  const disabled = !isAdmin || !loaded || saving;

  return (
    <section className="space-y-3">
      <header className="flex items-start gap-3">
        <div className="rounded-lg bg-emerald-500/10 p-2">
          <Zap className="h-4 w-4 text-emerald-500" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight text-strong">
            Recall quality
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Three default-ON recall enhancements. Each costs a small amount per turn — toggle off if
            you&apos;re optimizing for cost over recall quality.
          </p>
        </div>
      </header>

      <div className="space-y-2">
        <ToggleRow
          label="HyDE (hypothetical document embedding)"
          help="Generates a fake answer for the user's question, then embeds that instead of the raw query. Fixes the question↔statement embedding-space mismatch. Costs ~1 cheap LLM call per recall turn."
          // The UI shows "feature ON" semantics. The persisted shape is a
          // kill-switch (disable_*) — invert when reading + writing.
          enabled={!settings.disableHyde}
          disabled={disabled}
          onChange={(on) => patch({ disableHyde: !on })}
        />
        <ToggleRow
          label="Cross-encoder rerank"
          help="Reorders the recall top-K with joint (query, fact) scoring. Uses Cohere when COHERE_API_KEY is set, else a local lexical reranker. Adds ~50ms per turn."
          enabled={!settings.disableRerank}
          disabled={disabled}
          onChange={(on) => patch({ disableRerank: !on })}
        />
        <ToggleRow
          label="Graph expansion (1-hop)"
          help="After recall, traverses derived_from / supersedes / part_of edges to surface adjacent facts. One extra SQL query. Adds ~10-15% recall quality."
          enabled={!settings.disableGraph}
          disabled={disabled}
          onChange={(on) => patch({ disableGraph: !on })}
        />
      </div>

      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-strong">Premium embedding model</h3>
          <p className="text-xs text-muted">
            Use a richer embedding model for facts that matter more (pinned, high-confidence, or
            workspace-scope trait/preference/event). Other facts continue to use the default
            cheap-tier model. Leave provider empty to disable tiering.
          </p>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {mounted ? (
            <Select
              size="sm"
              aria-label="Premium provider"
              label="Provider"
              placeholder="Use default"
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
              <SelectItem key="">Use default</SelectItem>
              <SelectItem key="openai">OpenAI</SelectItem>
              <SelectItem key="voyage">Voyage</SelectItem>
              <SelectItem key="cohere">Cohere</SelectItem>
            </Select>
          ) : (
            <div className="h-14 rounded-md bg-elevated" aria-hidden />
          )}
          <Input
            size="sm"
            aria-label="Premium model"
            label="Model"
            placeholder={
              settings.premiumEmbeddingProvider === "openai"
                ? "text-embedding-3-large"
                : settings.premiumEmbeddingProvider === "voyage"
                  ? "voyage-3-large"
                  : settings.premiumEmbeddingProvider === "cohere"
                    ? "embed-v4.0"
                    : "Pick a provider first"
            }
            isDisabled={disabled || !settings.premiumEmbeddingProvider}
            value={settings.premiumEmbeddingModel ?? ""}
            onValueChange={(v) => {
              // Persist on blur — `onValueChange` fires every keystroke;
              // we capture the final value into local state and PATCH on
              // blur to avoid one HTTP roundtrip per keypress.
              setSettings((s) => ({ ...s, premiumEmbeddingModel: v }));
            }}
            onBlur={() => {
              patch({ premiumEmbeddingModel: settings.premiumEmbeddingModel || null });
            }}
          />
        </div>
      </div>
    </section>
  );
}

interface ToggleRowProps {
  label: string;
  help: string;
  enabled: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({ label, help, enabled, disabled, onChange }: ToggleRowProps) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-strong">{label}</p>
        <p className="mt-0.5 text-xs text-muted">{help}</p>
      </div>
      <Switch
        isSelected={enabled}
        onValueChange={onChange}
        isDisabled={disabled}
        aria-label={label}
      />
    </label>
  );
}

interface ConfirmRunModalProps {
  op: OpDef | null;
  running: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function ConfirmRunModal({ op, running, onClose, onConfirm }: ConfirmRunModalProps) {
  const t = useTranslations("settings.memory");
  return (
    <Modal isOpen={!!op} onClose={onClose} size="md" backdrop="blur">
      <ModalContent>
        <ModalHeader>
          <h2 className="text-base font-semibold text-strong">
            {op ? t("confirm.title", { op: t(`ops.${op.id}.name`) }) : ""}
          </h2>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-muted">{t("confirm.body")}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose} isDisabled={running}>
            {t("actions.cancel")}
          </Button>
          <Button color="primary" onPress={onConfirm} isLoading={running}>
            {t("actions.runNow")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * Defensive read of the `snapshot_at` / `capturedAt` field — different
 * call sites have used both names. The shape is `[extra: string]:
 * unknown` so we have to widen.
 */
function readSnapshotAt(snapshot: unknown): string | Date | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const obj = snapshot as Record<string, unknown>;
  const v = obj["snapshotAt"] ?? obj["snapshot_at"] ?? obj["capturedAt"] ?? obj["captured_at"];
  if (typeof v === "string" || v instanceof Date) return v;
  return null;
}
