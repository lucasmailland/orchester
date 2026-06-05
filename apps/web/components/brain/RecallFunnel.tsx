"use client";

// apps/web/components/brain/RecallFunnel.tsx
//
// Inspector UI v2 — Recall pipeline visualizer.
//
// Renders the per-stage RecallMetricEvent stream returned by
// /api/mnemo/recall-debug as a vertical funnel. Each stage is a card
// with header (name · duration · count · top score) and a collapsible
// body that surfaces the sample previews captured under `captureTrace`.
//
// All data comes pre-shaped from the server — this component is pure
// rendering. The endpoint enforces the security policy (rate limit +
// audit + sample preview truncation), so the UI doesn't need to
// defend against arbitrarily-large payloads.

import { useMemo, useState } from "react";
import { Chip } from "@heroui/react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { RecallMetricEvent, RecallStage, RecallSample } from "@orchester/mnemosyne";

export interface RecallFunnelProps {
  events: RecallMetricEvent[];
  /** When set, rendered above the funnel as a sticky failure banner. */
  errorMessage?: string;
}

// Display order — the canonical pipeline flow. Stages that don't fire
// in a given run (e.g. drawer_grep with no pointer hits) are simply
// absent from `events` and we render nothing for them.
const STAGE_ORDER: RecallStage[] = [
  "query_prep",
  "pointer_lookup",
  "first_stage",
  "drawer_grep",
  "co_location_boost",
  "single_term_dampener",
  "rerank_early_exit",
  "rerank",
  "prune",
  "diversity",
  "graph_expand",
  "total",
];

const STAGE_LABEL: Record<RecallStage, string> = {
  query_prep: "Query prep",
  pointer_lookup: "Pointer lookup",
  first_stage: "First-stage retrieval",
  drawer_grep: "Drawer-grep",
  co_location_boost: "Co-location boost",
  single_term_dampener: "Single-term dampener",
  rerank: "Rerank",
  rerank_early_exit: "Rerank early-exit",
  prune: "Prune (near-dup)",
  diversity: "Entity diversity cap",
  graph_expand: "Graph expansion",
  total: "Total",
};

const STAGE_DESCRIPTION: Record<RecallStage, string> = {
  query_prep: "Contextualizes and HyDE-expands the user query before retrieval.",
  pointer_lookup: "Looks up the pointer index to find the most relevant entity drawers.",
  first_stage: "Hybrid FTS+vector retrieval over mnemo_fact.",
  drawer_grep: "Entity-filtered FTS targeting the pointer-hit drawers.",
  co_location_boost: "+0.04 bonus to entities with ≥2 hits in the merged pool.",
  single_term_dampener: "×0.6 score multiplier on queries with one content word.",
  rerank: "Cross-encoder rerank (Cohere or local lexical).",
  rerank_early_exit: "Skipped the reranker because the top score ≥ 0.92.",
  prune: "Drops facts whose cosine to an already-kept fact exceeds the threshold.",
  diversity: "Caps each entity at max(2, ceil(maxResults × 0.15)) slots.",
  graph_expand: "1-hop traversal via mnemo_relation; verb-priority weighted.",
  total: "Wall-clock for the entire pipeline.",
};

export function RecallFunnel({ events, errorMessage }: RecallFunnelProps) {
  // Group events by stage so a stage that emits twice (today: nothing
  // does, but the shape is forward-compatible) renders together.
  const eventsByStage = useMemo(() => {
    const grouped = new Map<RecallStage, RecallMetricEvent[]>();
    for (const e of events) {
      const arr = grouped.get(e.stage) ?? [];
      arr.push(e);
      grouped.set(e.stage, arr);
    }
    return grouped;
  }, [events]);

  if (events.length === 0 && !errorMessage) {
    return (
      <div className="text-default-500 text-sm italic">
        No pipeline events captured yet. Run a recall to populate the funnel.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {errorMessage ? (
        <div className="bg-danger-50 text-danger-700 border-danger-200 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Pipeline failed: <code>{errorMessage}</code>. Partial trace shown below.
          </span>
        </div>
      ) : null}
      {STAGE_ORDER.flatMap((stage) => {
        const stageEvents = eventsByStage.get(stage);
        if (!stageEvents) return [];
        return stageEvents.map((event, i) => <StageCard key={`${stage}-${i}`} event={event} />);
      })}
    </div>
  );
}

// ── Per-stage card ───────────────────────────────────────────────────────────

interface StageCardProps {
  event: RecallMetricEvent;
}

function StageCard({ event }: StageCardProps) {
  const [open, setOpen] = useState(false);
  const samples = event.samples ?? [];
  const hasBody = samples.length > 0 || (event.extra && Object.keys(event.extra).length > 0);
  const status = stageStatus(event);

  return (
    <div className="border-default-200 bg-content1 rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasBody}
        className="flex w-full items-center gap-3 px-3 py-2 text-left disabled:cursor-default"
      >
        <span className="text-default-400 w-4 shrink-0">
          {hasBody ? (
            open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : (
            <span className="block h-4 w-4" />
          )}
        </span>
        <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
          {STAGE_LABEL[event.stage]}
        </span>
        <span className="text-default-500 hidden flex-shrink-0 items-center gap-3 text-xs sm:flex">
          {event.durationMs !== undefined ? (
            <Metric label="⏱" value={fmtMs(event.durationMs)} />
          ) : null}
          {event.count !== undefined ? <Metric label="#" value={String(event.count)} /> : null}
          {event.topScore !== undefined ? (
            <Metric label="top" value={event.topScore.toFixed(3)} />
          ) : null}
        </span>
        <StatusChip status={status} />
      </button>
      {open && hasBody ? (
        <div className="border-default-100 border-t px-3 py-3">
          <p className="text-default-500 mb-3 text-xs">{STAGE_DESCRIPTION[event.stage]}</p>
          {event.extra ? <ExtraTable extra={event.extra} /> : null}
          {samples.length > 0 ? <SampleList samples={samples} /> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Subviews ────────────────────────────────────────────────────────────────

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="font-mono">
      <span className="text-default-400">{label}</span> {value}
    </span>
  );
}

function StatusChip({ status }: { status: ReturnType<typeof stageStatus> }) {
  switch (status) {
    case "ok":
      return (
        <Chip size="sm" variant="flat" color="success">
          ok
        </Chip>
      );
    case "dropped":
      return (
        <Chip size="sm" variant="flat" color="warning">
          dropped
        </Chip>
      );
    case "skipped":
      return (
        <Chip size="sm" variant="flat" color="default">
          skipped
        </Chip>
      );
    case "info":
      return (
        <Chip size="sm" variant="flat" color="primary">
          info
        </Chip>
      );
  }
}

function ExtraTable({ extra }: { extra: NonNullable<RecallMetricEvent["extra"]> }) {
  const entries = Object.entries(extra);
  if (entries.length === 0) return null;
  return (
    <dl className="mb-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
      {entries.map(([k, v]) => (
        <FragmentRow key={k} k={k} v={String(v)} />
      ))}
    </dl>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-default-500 font-mono">{k}</dt>
      <dd className="text-foreground font-mono">{v}</dd>
    </>
  );
}

function SampleList({ samples }: { samples: RecallSample[] }) {
  return (
    <div>
      <div className="text-default-500 mb-1 text-xs uppercase tracking-wide">Samples</div>
      <ul className="flex flex-col gap-1">
        {samples.map((s, i) => (
          <li
            key={`${s.factId}-${i}`}
            className="border-default-100 bg-default-50 flex flex-col gap-0.5 rounded border px-2 py-1 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <code className="text-default-500 truncate">{s.factId.slice(0, 8)}…</code>
              <span className="text-default-600 font-mono">{s.score.toFixed(3)}</span>
            </div>
            <p className="text-foreground line-clamp-2">{s.preview}</p>
            {s.note ? <p className="text-warning-600 text-[10px] italic">{s.note}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

function stageStatus(event: RecallMetricEvent): "ok" | "dropped" | "skipped" | "info" {
  if (event.stage === "rerank_early_exit") return "info";
  if (event.stage === "co_location_boost") return "info";
  const droppedTag = event.extra?.["dropped"];
  if (typeof droppedTag === "number" && droppedTag > 0) return "dropped";
  if (event.count === 0) return "skipped";
  return "ok";
}
