"use client";

import { useState } from "react";
import { BookText, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/components/ui/Markdown";

/**
 * Documentación del flujo en markdown: qué hace, qué lo dispara y qué pasa si
 * falla. La vista previa usa el componente Markdown compartido, que nunca
 * renderiza HTML crudo, así que un texto pegado de cualquier lado no puede
 * ejecutar nada.
 */

export const SPEC_TEMPLATE = [
  "## Purpose",
  "",
  "## Trigger",
  "",
  "## Steps",
  "",
  "## Side effects",
  "",
  "## Failure handling",
  "",
  "## Dependencies",
  "",
].join("\n");

export function FlowDocsPanel({
  spec,
  onChange,
  onClose,
}: {
  spec: string;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("pages.flows.docs");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  return (
    <aside className="absolute right-0 top-0 z-20 flex h-full w-[380px] flex-col border-l border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-strong">
          <BookText className="h-3.5 w-3.5" /> {t("title")}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className="rounded px-2 py-1 text-[11px] hover:bg-hover"
          >
            {t("edit")}
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className="rounded px-2 py-1 text-[11px] hover:bg-hover"
          >
            {t("preview")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded p-1 hover:bg-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-3">
        {!spec.trim() && (
          <button
            type="button"
            onClick={() => onChange(SPEC_TEMPLATE)}
            className="mb-2 rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-hover"
          >
            {t("useTemplate")}
          </button>
        )}
        {mode === "edit" ? (
          <textarea
            value={spec}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t("placeholder")}
            className="h-full min-h-[400px] w-full resize-none rounded-lg border border-line bg-elevated p-2 font-mono text-xs text-strong outline-none focus:border-violet-500/60"
          />
        ) : (
          <Markdown content={spec} className="text-xs text-body" />
        )}
      </div>
    </aside>
  );
}
