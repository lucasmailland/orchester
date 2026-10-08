"use client";

import { useState } from "react";
import { Plus, Tag, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  EXTERNAL_CALLER_NAME_MAX,
  EXTERNAL_CALLER_NOTE_MAX,
  MAX_EXTERNAL_CALLERS,
  type ExternalCaller,
  type FlowKind,
} from "@/lib/flows/kind";
import type { FlowRelations } from "@/lib/flows/relations";
import { FlowRelationsSection } from "./FlowRelations";

/**
 * Flow type (pipeline or action) and the callers that live outside the
 * product. Saves on its own with PATCH: these are flow settings, not part of
 * the graph, so they do not go through the editor's auto-save.
 */
export function FlowKindPanel({
  flowId,
  kind: initialKind,
  externalCallers: initialCallers,
  contractIssues,
  relations,
  onSaved,
  onClose,
}: {
  flowId: string;
  kind: FlowKind;
  externalCallers: ExternalCaller[];
  /** Already-localized action contract problems of the current graph. */
  contractIssues: string[];
  /** Flows around this one; null while loading or when it could not be read. */
  relations?: FlowRelations | null;
  onSaved: (kind: FlowKind, externalCallers: ExternalCaller[]) => void;
  onClose: () => void;
}) {
  const t = useTranslations("pages.flows.kind");
  const [kind, setKind] = useState<FlowKind>(initialKind);
  const [rows, setRows] = useState<Array<{ name: string; note: string }>>(
    initialCallers.map((c) => ({ name: c.name, note: c.note ?? "" }))
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    // Blank rows are dropped rather than rejected: the list is a convenience.
    const externalCallers: ExternalCaller[] = rows
      .map((r) => ({ name: r.name.trim(), note: r.note.trim() }))
      .filter((r) => r.name)
      .map((r) => (r.note ? { name: r.name, note: r.note } : { name: r.name }));
    setSaving(true);
    try {
      const r = await fetch(`/api/flows/${flowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, externalCallers }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? t("saveError"));
        return;
      }
      toast.success(t("saved"));
      onSaved(kind, externalCallers);
    } catch {
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  const option = (value: FlowKind) => (
    <div className="rounded-lg border border-line p-2">
      <label className="flex items-center gap-2 text-xs font-medium text-strong">
        <input
          type="radio"
          name="flow-kind"
          value={value}
          checked={kind === value}
          onChange={() => setKind(value)}
          aria-describedby={`flow-kind-${value}-help`}
        />
        {t(value)}
      </label>
      <p id={`flow-kind-${value}-help`} className="mt-1 pl-5 text-[11px] text-muted">
        {t(`${value}Help`)}
      </p>
    </div>
  );

  return (
    <aside className="absolute right-0 top-0 z-20 flex h-full w-[380px] flex-col border-l border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-strong">
          <Tag className="h-3.5 w-3.5" /> {t("title")}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="rounded p-1 hover:bg-hover"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="flex-1 space-y-4 overflow-auto p-3">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[11px] font-medium uppercase text-muted">
            {t("kindLabel")}
          </legend>
          {option("pipeline")}
          {option("action")}
        </fieldset>

        {kind === "action" && contractIssues.length > 0 && (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300"
          >
            <p className="font-medium">{t("contractTitle")}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {contractIssues.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        {relations ? <FlowRelationsSection relations={relations} /> : null}

        <section className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase text-muted">{t("externalTitle")}</h3>
          <p className="text-[11px] text-muted">{t("externalHelp")}</p>
          {rows.length === 0 && <p className="text-[11px] text-faint">{t("externalEmpty")}</p>}
          {rows.map((row, i) => (
            <div key={i} className="space-y-1 rounded-lg border border-line p-2">
              <div className="flex items-center gap-1">
                <input
                  value={row.name}
                  maxLength={EXTERNAL_CALLER_NAME_MAX}
                  placeholder={t("namePlaceholder")}
                  aria-label={t("namePlaceholder")}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((r, j) => (j === i ? { ...r, name: e.target.value } : r))
                    )
                  }
                  className="w-full rounded border border-line bg-elevated px-2 py-1 text-xs text-strong outline-none focus:border-violet-500/60"
                />
                <button
                  type="button"
                  aria-label={t("remove")}
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  className="rounded p-1 text-muted hover:bg-hover hover:text-strong"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                value={row.note}
                maxLength={EXTERNAL_CALLER_NOTE_MAX}
                placeholder={t("notePlaceholder")}
                aria-label={t("notePlaceholder")}
                onChange={(e) =>
                  setRows((rs) => rs.map((r, j) => (j === i ? { ...r, note: e.target.value } : r)))
                }
                className="w-full rounded border border-line bg-elevated px-2 py-1 text-xs text-strong outline-none focus:border-violet-500/60"
              />
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, { name: "", note: "" }])}
              disabled={rows.length >= MAX_EXTERNAL_CALLERS}
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> {t("add")}
            </button>
            <span className="text-[11px] text-faint">
              {t("limit", { max: MAX_EXTERNAL_CALLERS })}
            </span>
          </div>
        </section>
      </div>
      <footer className="border-t border-line p-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
        >
          {t("save")}
        </button>
      </footer>
    </aside>
  );
}
