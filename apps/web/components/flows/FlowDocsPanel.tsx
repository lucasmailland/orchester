"use client";

import { useState } from "react";
import { BookText, X } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Documentación del flujo en markdown: qué hace, qué lo dispara y qué pasa si
 * falla. La vista previa arma nodos de React con un subconjunto seguro de
 * markdown (títulos, viñetas, párrafos): nunca inyecta HTML, así que un texto
 * pegado de cualquier lado no puede ejecutar nada.
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

function Preview({ text }: { text: string }) {
  const blocks = text.split("\n");
  return (
    <div className="space-y-1 text-xs text-body">
      {blocks.map((line, i) => {
        const h = /^(#{1,3})\s+(.*)$/.exec(line);
        if (h) {
          const Tag = `h${h[1]!.length + 2}` as "h3" | "h4" | "h5";
          return (
            <Tag key={i} className="mt-2 font-semibold text-strong">
              {h[2]}
            </Tag>
          );
        }
        const li = /^\s*[-*]\s+(.*)$/.exec(line);
        if (li)
          return (
            <li key={i} className="ml-4 list-disc">
              {li[1]}
            </li>
          );
        return line.trim() ? <p key={i}>{line}</p> : null;
      })}
    </div>
  );
}

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
          <Preview text={spec} />
        )}
      </div>
    </aside>
  );
}
