"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { GROUP_DESCRIPTION_MAX, GROUP_NAME_MAX, type FlowGroupIcon } from "@/lib/flows/groups";
import type { ExtractionBlock, ExtractionPlan, ExtractionResult } from "@/lib/flows/extract";
import type { GroupMeta } from "./GroupDialog";
import { IconPicker } from "./GroupDialog";

/**
 * Preview and confirmation of "Extract to flow": which steps move, what goes
 * in and what comes back, what kind of flow it becomes and why, and anything
 * that changes for the caller. When the steps cannot move, it says why and
 * offers nothing to confirm.
 */
export function ExtractDialog({
  result,
  initial,
  labelOf,
  onConfirm,
  onClose,
}: {
  result: ExtractionResult;
  initial?: GroupMeta | undefined;
  /** A step's label, to name steps instead of showing ids. */
  labelOf: (nodeId: string) => string;
  /** Resolves with an error message to show, or null when it worked. */
  onConfirm: (meta: GroupMeta) => Promise<string | null>;
  onClose: () => void;
}) {
  const t = useTranslations("pages.flows.extract");
  const tGroups = useTranslations("pages.flows.groups");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState<FlowGroupIcon | undefined>(initial?.icon);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const missingName = name.trim() === "";

  async function confirm() {
    setTouched(true);
    if (missingName || !result.ok) return;
    setBusy(true);
    setError(null);
    const desc = description.replace(/\s*[\r\n]+\s*/g, " ").trim();
    const message = await onConfirm({
      name: name.trim(),
      ...(desc ? { description: desc } : {}),
      ...(icon ? { icon } : {}),
    });
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="extract-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-app/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-start justify-between border-b border-line p-5 pb-3">
          <div>
            <h2 id="extract-dialog-title" className="text-sm font-semibold text-strong">
              {t("title")}
            </h2>
            {result.ok && <p className="mt-0.5 text-xs text-muted">{t("intro")}</p>}
          </div>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1 text-muted hover:bg-hover hover:text-body"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5 text-xs">
          {!result.ok ? (
            <div
              role="alert"
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-amber-700 dark:text-amber-300"
            >
              <p className="mb-1.5 flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {t("blockedTitle")}
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {result.blocks.map((b, i) => (
                  <li key={i}>{blockText(t, b, labelOf)}</li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="extract-name"
                  className="mb-1 block text-[11px] font-medium text-body"
                >
                  {tGroups("nameLabel")}
                </label>
                <input
                  id="extract-name"
                  value={name}
                  maxLength={GROUP_NAME_MAX}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={tGroups("namePlaceholder")}
                  aria-invalid={touched && missingName}
                  className="w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-strong outline-none focus:border-violet-500/60"
                />
                {touched && missingName && (
                  <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                    {t("nameRequired")}
                  </p>
                )}
                <label
                  htmlFor="extract-description"
                  className="mb-1 mt-3 block text-[11px] font-medium text-body"
                >
                  {tGroups("descriptionLabel")}
                </label>
                <input
                  id="extract-description"
                  value={description}
                  maxLength={GROUP_DESCRIPTION_MAX}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={tGroups("descriptionPlaceholder")}
                  className="w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-strong outline-none focus:border-violet-500/60"
                />
                <IconPicker value={icon} onChange={setIcon} />
              </div>
              <PlanPreview plan={result.plan} labelOf={labelOf} />
            </>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-red-500/5 p-2 text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-body hover:bg-hover"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!result.ok || busy}
            className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {busy ? t("creating") : t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The `pages.flows.extract` translator. */
type T = (key: string, values?: Record<string, string | number>) => string;

/** One refusal, in the reader's language, naming steps by their label. */
export function blockText(t: T, b: ExtractionBlock, labelOf: (id: string) => string): string {
  const step = b.nodeId ? `"${labelOf(b.nodeId)}"` : "";
  const count = b.count ?? 0;
  switch (b.code) {
    case "parent_is_action":
      return t("block_parent_is_action");
    case "empty":
      return t("block_empty");
    case "unknown_group":
      return t("block_unknown_group");
    case "unknown_step":
      return t("block_unknown_step", { step });
    case "trigger_inside":
      return t("block_trigger_inside", { step });
    case "wait_human_inside":
      return t("block_wait_human_inside", { step });
    case "group_split":
      return t("block_group_split");
    case "entries":
      return t("block_entries", { count });
    case "exits":
      return t("block_exits", { count });
    case "cycle":
      return t("block_cycle", { step });
    case "branch_ends":
      return t("block_branch_ends", { step });
    case "fan_out":
      return t("block_fan_out", { step });
    case "exit_on_branch":
      return t("block_exit_on_branch", { step });
    case "exit_in_branch":
      return t("block_exit_in_branch", { step });
    case "unreachable":
      return t("block_unreachable", { step });
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Names({ names }: { names: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((v) => (
        <code key={v} className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px]">
          {v}
        </code>
      ))}
    </div>
  );
}

function PlanPreview({ plan, labelOf }: { plan: ExtractionPlan; labelOf: (id: string) => string }) {
  const t = useTranslations("pages.flows.extract");
  const stepsOf = (ids: Array<{ nodeId: string }>) =>
    [...new Set(ids.map((u) => `"${labelOf(u.nodeId)}"`))].join(", ");
  return (
    <div className="space-y-3" data-testid="extract-preview">
      <Section title={t("stepsTitle")}>
        <ol className="list-decimal space-y-0.5 pl-5 text-body">
          {plan.nodeIds.map((id) => (
            <li key={id}>{labelOf(id)}</li>
          ))}
        </ol>
      </Section>
      <Section title={t("inputsTitle")}>
        {plan.inputs === null ? (
          <p className="text-body">{t("inputsAll", { steps: stepsOf(plan.inputsUnknown) })}</p>
        ) : plan.inputs.length === 0 ? (
          <p className="text-muted">{t("inputsNone")}</p>
        ) : (
          <Names names={plan.inputs} />
        )}
      </Section>
      <Section title={t("outputsTitle")}>
        {plan.outputs === null ? (
          <p className="text-body">{t("outputsAll")}</p>
        ) : plan.outputs.length === 0 ? (
          <p className="text-muted">{t("outputsNone")}</p>
        ) : (
          <Names names={plan.outputs} />
        )}
      </Section>
      {(plan.staysInside.length > 0 || plan.staysInsideUnknown.length > 0) && (
        <Section title={t("staysTitle")}>
          {plan.staysInside.length > 0 && <Names names={plan.staysInside} />}
          {plan.staysInsideUnknown.length > 0 && (
            <p className="mt-1 text-muted">
              {t("staysUnknown", { steps: stepsOf(plan.staysInsideUnknown) })}
            </p>
          )}
        </Section>
      )}
      <Section title={t("kindTitle")}>
        {plan.kind === "action" ? (
          <p className="text-body" data-testid="extract-kind">
            {t("kindAction")}
          </p>
        ) : (
          <div className="text-body" data-testid="extract-kind">
            <p>{t("kindPipeline")}</p>
            <ul className="list-disc pl-5">
              {plan.kindReasons.map((r, i) => {
                const step = `"${labelOf(r.nodeId ?? "")}"`;
                return (
                  <li key={i}>
                    {r.code === "ai"
                      ? t("whyAi", { step })
                      : r.code === "human"
                        ? t("whyHuman", { step })
                        : t("whyFlowCall", { step })}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Section>
      <ul className="space-y-1 rounded-lg border border-line bg-card p-2.5 text-[11px] text-muted">
        {plan.notes.includes("created_enabled") && <li>{t("noteEnabled")}</li>}
        {plan.notes.includes("error_prefix") && <li>{t("noteError")}</li>}
        {plan.notes.includes("inside_try") && <li>{t("noteTry")}</li>}
        {plan.notes.includes("inside_loop") && <li>{t("noteLoop")}</li>}
        {plan.notes.includes("calls_subflows") && <li>{t("noteSubflows")}</li>}
        <li>{t("noteRestore")}</li>
      </ul>
    </div>
  );
}
