"use client";

// apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/recall-debug/
//   RecallDebugClient.tsx
//
// Inspector UI v2 — main client. Wraps the RecallFunnel + the query
// form. Stateful entirely in this file (no SWR cache — debug calls
// are fire-and-forget per click).
//
// Options panel exposes the recall pipeline toggles that meaningfully
// change the funnel shape:
//   - HyDE on/off          → affects query_prep stage
//   - Contextualize on/off → affects query_prep stage
//   - Graph expand on/off  → affects graph_expand stage
//   - topK 1-20            → affects all stage caps via tieredCap
//
// Reranker / pointer / co-location toggles aren't surfaced — those
// reflect workspace-wide settings, not per-call debug overrides.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, Input, Switch, Skeleton, Chip } from "@heroui/react";
import { Play, RotateCcw, ArrowLeft, Zap } from "lucide-react";
import { useRecallDebug, type RecallDebugInput } from "@/lib/hooks/use-recall-debug";
import { RecallFunnel } from "@/components/brain/RecallFunnel";

const DEFAULT_OPTIONS: NonNullable<RecallDebugInput["options"]> = {
  enableHyDE: true,
  enableContextualize: true,
  expandGraph: true,
};

export function RecallDebugClient() {
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";

  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [options, setOptions] = useState<NonNullable<RecallDebugInput["options"]>>(DEFAULT_OPTIONS);

  const { result, isLoading, run, reset } = useRecallDebug();

  const canRun = query.trim().length > 0 && !isLoading;

  const onRun = async (): Promise<void> => {
    if (!canRun) return;
    await run({ query: query.trim(), topK, options });
  };

  // Surface basic stats above the funnel so users don't have to scan
  // for the totals.
  const summary = useMemo(() => {
    if (!result) return null;
    const totalEvent = result.events.find((e) => e.stage === "total");
    const pipelineMs = totalEvent?.durationMs;
    return {
      hits: result.items.length,
      pipelineMs,
      clientMs: result.clientLatencyMs,
    };
  }, [result]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <Link
            href={`/${locale}/${ws}/brain`}
            className="text-default-500 hover:text-primary mb-1 inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Inspector
          </Link>
          <h1 className="text-foreground text-2xl font-semibold">Recall debug</h1>
          <p className="text-default-500 text-sm">
            Trace the recall pipeline stage-by-stage for any query in this workspace.
          </p>
        </div>
        <Chip color="warning" variant="flat" size="sm">
          rate-limited 10/min
        </Chip>
      </header>

      {/* Query input ─────────────────────────────────────────────── */}
      <section className="bg-content1 border-default-200 flex flex-col gap-4 rounded-xl border p-4 shadow-sm">
        <Input
          variant="bordered"
          label="Query"
          labelPlacement="outside"
          placeholder="e.g. what does the user prefer for databases?"
          value={query}
          onValueChange={setQuery}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void onRun();
          }}
          description="⌘/Ctrl + Enter to run"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <OptionsPanel options={options} onChange={setOptions} />
          <ScalarsPanel topK={topK} onTopK={setTopK} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            color="primary"
            startContent={<Play className="h-4 w-4" />}
            onPress={onRun}
            isDisabled={!canRun}
            isLoading={isLoading}
          >
            Run recall
          </Button>
          {result ? (
            <Button
              variant="bordered"
              startContent={<RotateCcw className="h-4 w-4" />}
              onPress={reset}
              isDisabled={isLoading}
            >
              Clear
            </Button>
          ) : null}
          {summary ? (
            <span className="text-default-500 ml-auto flex items-center gap-3 text-xs">
              <span>
                <strong className="text-foreground">{summary.hits}</strong> hits
              </span>
              {summary.pipelineMs !== undefined ? (
                <span>
                  pipeline{" "}
                  <strong className="text-foreground">{Math.round(summary.pipelineMs)}ms</strong>
                </span>
              ) : null}
              <span>
                round-trip{" "}
                <strong className="text-foreground">{Math.round(summary.clientMs)}ms</strong>
              </span>
            </span>
          ) : null}
        </div>
      </section>

      {/* Funnel ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-foreground flex items-center gap-2 text-lg font-semibold">
          <Zap className="text-primary h-4 w-4" /> Pipeline funnel
        </h2>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : result ? (
          <RecallFunnel
            events={result.events}
            {...(result.errorMessage ? { errorMessage: result.errorMessage } : {})}
          />
        ) : (
          <div className="text-default-500 text-sm italic">
            Submit a query above to capture and visualize a recall trace.
          </div>
        )}
      </section>
    </div>
  );
}

// ── Subviews ───────────────────────────────────────────────────────────────

interface OptionsPanelProps {
  options: NonNullable<RecallDebugInput["options"]>;
  onChange: (next: NonNullable<RecallDebugInput["options"]>) => void;
}

function OptionsPanel({ options, onChange }: OptionsPanelProps) {
  const toggle = (key: keyof NonNullable<RecallDebugInput["options"]>) =>
    onChange({ ...options, [key]: !options[key] });

  return (
    <div className="border-default-200 bg-default-50 flex flex-col gap-2 rounded-lg border p-3">
      <span className="text-default-500 text-xs font-semibold uppercase tracking-wide">
        Pipeline options
      </span>
      <SwitchRow
        label="HyDE"
        checked={!!options.enableHyDE}
        onChange={() => toggle("enableHyDE")}
      />
      <SwitchRow
        label="Contextualize"
        checked={!!options.enableContextualize}
        onChange={() => toggle("enableContextualize")}
      />
      <SwitchRow
        label="Graph expand"
        checked={!!options.expandGraph}
        onChange={() => toggle("expandGraph")}
      />
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-foreground">{label}</span>
      <Switch size="sm" isSelected={checked} onValueChange={onChange} aria-label={label} />
    </label>
  );
}

interface ScalarsPanelProps {
  topK: number;
  onTopK: (n: number) => void;
}

function ScalarsPanel({ topK, onTopK }: ScalarsPanelProps) {
  return (
    <div className="border-default-200 bg-default-50 flex flex-col gap-2 rounded-lg border p-3">
      <span className="text-default-500 text-xs font-semibold uppercase tracking-wide">
        Scalars
      </span>
      <Input
        type="number"
        size="sm"
        variant="bordered"
        label="topK"
        labelPlacement="outside-left"
        value={String(topK)}
        min={1}
        max={20}
        step={1}
        onValueChange={(v) => {
          const n = Number(v);
          if (!Number.isFinite(n)) return;
          onTopK(Math.min(Math.max(Math.round(n), 1), 20));
        }}
        className="max-w-[180px]"
      />
    </div>
  );
}
