"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  listNodesByCategory,
  CATEGORY_LABELS,
  type Locale,
  type NodeDef,
} from "@/lib/flows/node-registry";
import { getNodeDocs } from "@/lib/flows/node-docs";
import { iconFor } from "./nodes/icon-map";

/**
 * Paleta de nodos generada desde el `node-registry`. Agrupa por categoría,
 * con buscador. Cada ítem muestra ícono + nombre + "qué hace" en humano.
 */
export function NodePalette({
  onAdd,
  locale,
}: {
  onAdd: (nodeId: string) => void;
  locale: Locale;
}) {
  const t = useTranslations("pages.flows.palette");
  const [query, setQuery] = useState("");
  const groups = useMemo(() => listNodesByCategory(), []);
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        category: g.category,
        nodes: g.nodes.filter(
          (n) =>
            n.title[locale].toLowerCase().includes(q) || n.summary[locale].toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.nodes.length > 0);
  }, [groups, q, locale]);

  return (
    <div className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
      <div className="border-b border-line p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-lg border border-line bg-elevated py-1.5 pl-7 pr-2 text-xs text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2.5">
        {filtered.map((g) => (
          <div key={g.category} className="mb-3">
            <div className="mb-1.5 px-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
              {CATEGORY_LABELS[g.category][locale]}
            </div>
            {g.nodes.map((n) => (
              <PaletteItem key={n.id} node={n} locale={locale} onAdd={onAdd} />
            ))}
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="px-1 py-4 text-center text-[11px] text-faint">
            {t("noMatches", { query })}
          </p>
        )}
      </div>
    </div>
  );
}

function PaletteItem({
  node,
  locale,
  onAdd,
}: {
  node: NodeDef;
  locale: Locale;
  onAdd: (nodeId: string) => void;
}) {
  const Icon = iconFor(node.icon);
  const docs = getNodeDocs(node.id);
  const whenToUseLabel =
    locale === "es" ? "Cuándo conviene" : locale === "pt-BR" ? "Quando usar" : "When to use";
  const tooltip = docs
    ? `${node.summary[locale]}\n\n${whenToUseLabel}: ${docs.whenToUse[locale]}`
    : node.summary[locale];
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/flow-node", node.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onAdd(node.id)}
      title={tooltip}
      className="group mb-1 flex w-full cursor-grab items-start gap-2 rounded-lg border border-line bg-card px-2 py-1.5 text-left transition-colors hover:bg-elevated active:cursor-grabbing"
    >
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: `${node.accent}1a`, color: node.accent }}
      >
        <Icon className="h-3 w-3" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-body">{node.title[locale]}</span>
        <span className="block truncate text-[10px] leading-tight text-faint">
          {node.summary[locale]}
        </span>
      </span>
    </button>
  );
}
