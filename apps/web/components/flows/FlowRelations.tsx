"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, Bot, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { relationCounts, type FlowLink, type FlowRelations } from "@/lib/flows/relations";

type Side = "usedBy" | "uses";

function useFlowHref() {
  const params = useParams<{ locale?: string; workspaceSlug?: string }>();
  return (id: string) => `/${params?.locale ?? "en"}/${params?.workspaceSlug ?? ""}/flows/${id}`;
}

function LinkRow({ link }: { link: FlowLink }) {
  const t = useTranslations("pages.flows.kind");
  const tr = useTranslations("pages.flows.kind.relations");
  const href = useFlowHref();
  return (
    <li className="rounded-lg border border-line p-2 text-xs">
      {link.missing ? (
        <p className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{tr("missing")}</span>
          <code className="truncate text-[10px] text-muted">{link.flowId}</code>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={href(link.flowId)}
            className="min-w-0 truncate font-medium text-violet-700 hover:underline dark:text-violet-300"
          >
            {link.name}
          </Link>
          {link.kind ? (
            <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-muted">
              {t(link.kind)}
            </span>
          ) : null}
          {link.ai ? (
            <span
              title={tr("aiMarker")}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-700 dark:text-violet-300"
            >
              <Bot className="h-2.5 w-2.5" aria-hidden="true" />
              {tr("ai")}
            </span>
          ) : null}
        </div>
      )}
      {link.steps.length > 0 ? (
        <p className="mt-1 text-[11px] text-muted">{tr("via", { steps: link.steps.join(", ") })}</p>
      ) : null}
    </li>
  );
}

/** The body of one side: used-by (callers, external callers, triggers) or uses. */
export function RelationsSide({ side, relations }: { side: Side; relations: FlowRelations }) {
  const tr = useTranslations("pages.flows.kind.relations");
  const empty = relationCounts(relations)[side] === 0;
  return (
    <div className="space-y-2">
      {empty ? <p className="text-[11px] text-faint">{tr(`${side}Empty`)}</p> : null}
      {side === "uses" && relations.uses.length > 0 ? (
        <ul className="space-y-1.5">
          {relations.uses.map((l) => (
            <LinkRow key={l.flowId} link={l} />
          ))}
        </ul>
      ) : null}
      {side === "usedBy" ? (
        <>
          {relations.usedBy.length > 0 ? (
            <ul className="space-y-1.5">
              {relations.usedBy.map((l) => (
                <LinkRow key={l.flowId} link={l} />
              ))}
            </ul>
          ) : null}
          {relations.externalCallers.length > 0 ? (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase text-muted">
                {tr("externalHeading")}
              </p>
              <ul className="space-y-1">
                {relations.externalCallers.map((c, i) => (
                  <li key={`${c.name}-${i}`} className="text-xs">
                    <span className="font-medium text-strong">{c.name}</span>
                    {c.note ? <span className="text-muted"> — {c.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {relations.webhooks > 0 || relations.schedules > 0 ? (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase text-muted">
                {tr("triggersHeading")}
              </p>
              <ul className="space-y-0.5 text-xs text-strong">
                {relations.webhooks > 0 ? (
                  <li>{tr("webhooks", { count: relations.webhooks })}</li>
                ) : null}
                {relations.schedules > 0 ? (
                  <li>{tr("schedules", { count: relations.schedules })}</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Editor section: both sides, always visible. */
export function FlowRelationsSection({ relations }: { relations: FlowRelations }) {
  const tr = useTranslations("pages.flows.kind.relations");
  return (
    <section className="space-y-3" aria-label={tr("title")}>
      <h3 className="text-[11px] font-medium uppercase text-muted">{tr("title")}</h3>
      {(["usedBy", "uses"] as const).map((side) => (
        <div key={side} className="space-y-1.5">
          <p className="text-[11px] font-medium text-strong">{tr(`${side}Title`)}</p>
          <RelationsSide side={side} relations={relations} />
        </div>
      ))}
    </section>
  );
}

const CHIP =
  "inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-violet-500/40 hover:text-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500";

/**
 * Two chips for the flows list ("Used by 2", "Uses 3"), each opening a small
 * popover with the details. Hidden at zero. Escape and outside click close it.
 */
export function FlowRelationChips({
  relations,
  onOpenChange,
}: {
  relations: FlowRelations;
  onOpenChange?: (open: boolean) => void;
}) {
  const tr = useTranslations("pages.flows.kind.relations");
  const counts = relationCounts(relations);
  const [open, setOpen] = useState<Side | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const triggers = useRef<Partial<Record<Side, HTMLButtonElement | null>>>({});
  const panelId = useId();

  useEffect(() => {
    onOpenChange?.(open !== null);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent | MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (counts.usedBy === 0 && counts.uses === 0) return null;

  const chips: Array<{ side: Side; Icon: typeof ArrowUpFromLine }> = [
    { side: "usedBy", Icon: ArrowUpFromLine },
    { side: "uses", Icon: ArrowDownToLine },
  ];

  return (
    <div
      ref={root}
      data-testid="flow-relations"
      className="relative flex flex-wrap items-center gap-1.5"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          const side = open;
          setOpen(null);
          triggers.current[side]?.focus();
        }
      }}
    >
      {chips
        .filter(({ side }) => counts[side] > 0)
        .map(({ side, Icon }) => (
          <button
            key={side}
            ref={(el) => {
              triggers.current[side] = el;
            }}
            type="button"
            className={CHIP}
            aria-haspopup="dialog"
            aria-expanded={open === side}
            aria-controls={open === side ? `${panelId}-${side}` : undefined}
            onClick={() => setOpen((o) => (o === side ? null : side))}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {tr(`${side}Chip`, { count: counts[side] })}
          </button>
        ))}
      {open ? (
        <div
          id={`${panelId}-${open}`}
          role="dialog"
          aria-label={tr(`${open}Title`)}
          className="absolute left-0 top-full z-30 mt-1 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-xl border border-line bg-surface p-2 shadow-lg"
        >
          <p className="mb-1.5 text-[11px] font-medium text-strong">{tr(`${open}Title`)}</p>
          <RelationsSide side={open} relations={relations} />
        </div>
      ) : null}
    </div>
  );
}
