"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ACTIVITY_KINDS,
  ACTIVITY_OUTCOMES,
  type ActivityFilterOptions,
  type ActivityKind,
  type ActivityResponse,
  type ActivityRow,
  type ActivityTotals,
  type OutcomeCounts,
} from "@/lib/activity/types";
import {
  DEFAULT_VIEW,
  MCP_VIEW,
  activityParams,
  formatDuration,
  formatTokens,
  formatUsd,
  isMcpView,
  toolLabel,
  type ActivityViewState,
  type RangePreset,
} from "@/lib/activity/view";

/**
 * The activity page: filters, totals, and the timeline with "Load more".
 *
 * The query string is computed when a filter changes and kept in state, so
 * "Load more" and the CSV export ask for exactly the range the shown rows
 * answer, not for a range that moved with the clock.
 */

const PRESETS: RangePreset[] = ["24h", "7d", "30d", "custom"];

const OUTCOME_TONE: Record<string, string> = {
  ok: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  error: "text-red-700 dark:text-red-300 bg-red-500/10 border-red-500/30",
  refused: "text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/30",
};

const KIND_TONE: Record<ActivityKind, string> = {
  tool_call: "text-violet-700 dark:text-violet-300 bg-violet-500/10 border-violet-500/30",
  model_usage: "text-blue-700 dark:text-blue-300 bg-blue-500/10 border-blue-500/30",
  flow_run: "text-teal-700 dark:text-teal-300 bg-teal-500/10 border-teal-500/30",
  conversation: "text-body bg-zinc-500/10 border-zinc-500/30",
  config_change: "text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/30",
};

interface Props {
  workspaceSlug: string;
  options: ActivityFilterOptions;
}

const queryOf = (view: ActivityViewState) => activityParams(view, new Date())?.toString() ?? null;

export function ActivityClient({ workspaceSlug, options }: Props) {
  const t = useTranslations("pages.activity");
  const locale = useLocale();
  const [view, setView] = useState<ActivityViewState>(DEFAULT_VIEW);
  // Set on mount, not during render: the range ends "now", and the server's
  // now would not match the browser's when the page hydrates.
  const [query, setQuery] = useState<string | null>(null);
  const [refDraft, setRefDraft] = useState("");
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [totals, setTotals] = useState<ActivityTotals | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [attempt, setAttempt] = useState(0);

  const base = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/activity`;

  function apply(next: ActivityViewState) {
    setView(next);
    setRefDraft(next.ref);
    setQuery(queryOf(next));
  }
  const update = (patch: Partial<ActivityViewState>) => apply({ ...view, ...patch });
  /** Keeps the range when switching between the two views. */
  const switchView = (target: ActivityViewState) =>
    apply({
      ...target,
      preset: view.preset,
      customFrom: view.customFrom,
      customTo: view.customTo,
    });

  useEffect(() => setQuery(queryOf(DEFAULT_VIEW)), []);

  useEffect(() => {
    if (!query) return;
    const ac = new AbortController();
    setLoading(true);
    setFailed(false);
    fetch(`${base}?${query}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`activity ${r.status}`);
        return (await r.json()) as ActivityResponse;
      })
      .then((body) => {
        if (ac.signal.aborted) return;
        setRows(body.rows);
        setTotals(body.totals);
        setNextCursor(body.nextCursor);
        setExpanded(new Set());
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setFailed(true);
        setRows([]);
        setTotals(null);
        setNextCursor(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [base, query, attempt]);

  async function loadMore() {
    if (!query || !nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`${base}?${query}&cursor=${encodeURIComponent(nextCursor)}`);
      if (!r.ok) throw new Error(`activity ${r.status}`);
      const body = (await r.json()) as ActivityResponse;
      setRows((prev) => [...prev, ...body.rows]);
      setNextCursor(body.nextCursor);
    } catch {
      toast.error(t("loadError"));
    } finally {
      setLoadingMore(false);
    }
  }

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleKind = (kind: ActivityKind) =>
    update({
      kinds: view.kinds.includes(kind)
        ? view.kinds.filter((k) => k !== kind)
        : ACTIVITY_KINDS.filter((k) => k === kind || view.kinds.includes(k)),
    });

  const mcp = isMcpView(view);
  const integrationTypes = [...new Set(options.integrations.map((i) => i.type))].sort();
  const mcpIntegrations = options.integrations.filter((i) => i.type === "mcp");
  const appPath = (link: string) => `/${locale}/${workspaceSlug}${link}`;

  return (
    <div className="space-y-5">
      {/* Views */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t("views.label")} className="flex gap-1">
          {(
            [
              ["all", DEFAULT_VIEW, !mcp],
              ["mcp", MCP_VIEW, mcp],
            ] as const
          ).map(([id, target, selected]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => switchView(target)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                selected
                  ? "border-violet-500/40 bg-violet-500/10 text-strong"
                  : "border-line bg-card text-muted hover:bg-hover hover:text-body"
              )}
            >
              {t(`views.${id}`)}
            </button>
          ))}
        </div>
        {query ? (
          <a
            href={`${base}/export?${query}`}
            download
            className="btn-secondary"
            title={t("exportHint")}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {t("export")}
          </a>
        ) : null}
      </div>
      {mcp ? <p className="text-xs text-muted">{t("mcpHint")}</p> : null}

      {/* Filters */}
      <div className="space-y-3 rounded-2xl border border-line bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="activity-range" label={t("range.label")}>
            <select
              id="activity-range"
              className="input"
              value={view.preset}
              onChange={(e) => update({ preset: e.target.value as RangePreset })}
            >
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {t(`range.${p}`)}
                </option>
              ))}
            </select>
          </Field>
          {view.preset === "custom" ? (
            <>
              <Field id="activity-from" label={t("range.from")}>
                <input
                  id="activity-from"
                  type="datetime-local"
                  className="input"
                  value={view.customFrom}
                  onChange={(e) => update({ customFrom: e.target.value })}
                />
              </Field>
              <Field id="activity-to" label={t("range.to")}>
                <input
                  id="activity-to"
                  type="datetime-local"
                  className="input"
                  value={view.customTo}
                  onChange={(e) => update({ customTo: e.target.value })}
                />
              </Field>
            </>
          ) : null}
          <Field id="activity-agent" label={t("filters.agent")}>
            <select
              id="activity-agent"
              className="input"
              value={view.agentId}
              onChange={(e) => update({ agentId: e.target.value })}
            >
              <option value="">{t("filters.any")}</option>
              {options.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="activity-flow" label={t("filters.flow")}>
            <select
              id="activity-flow"
              className="input"
              value={view.flowId}
              onChange={(e) => update({ flowId: e.target.value })}
            >
              <option value="">{t("filters.any")}</option>
              {options.flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="activity-integration" label={t("filters.integration")}>
            <select
              id="activity-integration"
              className="input"
              value={view.integration}
              onChange={(e) => update({ integration: e.target.value })}
            >
              <option value="">{t("filters.any")}</option>
              {integrationTypes.map((type) => (
                <option key={type} value={`type:${type}`}>
                  {t("filters.allOfType", { type })}
                </option>
              ))}
              {mcpIntegrations.map((i) => (
                <option key={i.id} value={`id:${i.id}`}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="activity-outcome" label={t("filters.outcome")}>
            <select
              id="activity-outcome"
              className="input"
              value={view.outcome}
              onChange={(e) => update({ outcome: e.target.value as ActivityViewState["outcome"] })}
            >
              <option value="">{t("filters.any")}</option>
              {ACTIVITY_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {t(`outcomes.${o}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="activity-ref" label={t("filters.ref")}>
            <input
              id="activity-ref"
              type="search"
              className="input"
              maxLength={64}
              placeholder={t("filters.refPlaceholder")}
              value={refDraft}
              onChange={(e) => setRefDraft(e.target.value)}
              onBlur={() => refDraft !== view.ref && update({ ref: refDraft })}
              onKeyDown={(e) => {
                if (e.key === "Enter") update({ ref: refDraft });
              }}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-faint">
            {t("filters.kinds")}
          </span>
          {ACTIVITY_KINDS.map((kind) => {
            const on = view.kinds.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                onClick={() => toggleKind(kind)}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                  on ? KIND_TONE[kind] : "border-line text-muted hover:text-body"
                )}
              >
                {t(`kinds.${kind}`)}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() =>
              apply({
                ...DEFAULT_VIEW,
                preset: view.preset,
                customFrom: view.customFrom,
                customTo: view.customTo,
              })
            }
            className="ml-auto text-[11px] text-muted underline hover:no-underline"
          >
            {t("filters.reset")}
          </button>
        </div>
        {view.preset === "custom" && !query ? (
          <p className="text-xs text-red-600 dark:text-red-300">{t("range.invalid")}</p>
        ) : null}
      </div>

      {/* Totals */}
      {totals ? <TotalsCards totals={totals} mcp={mcp} /> : null}

      {/* Timeline */}
      {failed ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-700 dark:text-red-300">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="flex-1">{t("loadError")}</span>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="underline hover:no-underline"
          >
            {t("retry")}
          </button>
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {t("loading")}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-8 text-xs text-muted">
          <ScrollText className="h-4 w-4" aria-hidden="true" />
          {t("empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className={cn("w-full text-left text-xs", loading && "opacity-60")}>
            <thead className="bg-surface text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="w-8 px-2 py-2">
                  <span className="sr-only">{t("table.details")}</span>
                </th>
                <th className="px-3 py-2">{t("table.when")}</th>
                <th className="px-3 py-2">{t("table.kind")}</th>
                <th className="px-3 py-2">{t("table.who")}</th>
                <th className="px-3 py-2">{t("table.what")}</th>
                <th className="px-3 py-2">{t("table.outcome")}</th>
                <th className="px-3 py-2 text-right">{t("table.tokens")}</th>
                <th className="px-3 py-2 text-right">{t("table.cost")}</th>
                <th className="px-3 py-2 text-right">{t("table.duration")}</th>
                <th className="w-8 px-2 py-2">
                  <span className="sr-only">{t("table.open")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = `${row.kind}:${row.id}`;
                const open = expanded.has(key);
                const who = row.agent ?? row.flow ?? row.channel;
                return (
                  <Fragment key={key}>
                    <tr className="border-t border-line bg-card align-top">
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          aria-expanded={open}
                          aria-label={open ? t("table.hide") : t("table.details")}
                          className="rounded p-0.5 text-muted hover:bg-hover hover:text-body"
                        >
                          {open ? (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted" title={row.at}>
                        {new Date(row.at).toLocaleString(locale)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px]",
                            KIND_TONE[row.kind]
                          )}
                        >
                          {t(`kinds.${row.kind}`)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-body">
                        {row.detail.kind === "config_change"
                          ? actorOf(row.detail.actor)
                          : who
                            ? (who.name ?? <span className="font-mono text-muted">{who.id}</span>)
                            : "—"}
                      </td>
                      <td className="max-w-[28rem] px-3 py-2">
                        <span className="break-all font-mono text-[11px] text-body">
                          {row.summary}
                        </span>
                        {row.integration?.name ? (
                          <span className="ml-1.5 whitespace-nowrap rounded border border-line px-1 py-px text-[10px] text-muted">
                            {row.integration.name}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {row.outcome ? (
                          <span
                            className={cn(
                              "rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                              OUTCOME_TONE[row.outcome]
                            )}
                          >
                            {t(`outcomes.${row.outcome}`)}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted">
                        {row.tokens?.total != null ? formatTokens(row.tokens.total) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted">
                        {row.costUsd != null ? formatUsd(row.costUsd) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-muted">
                        {row.durationMs != null ? formatDuration(row.durationMs) : "—"}
                      </td>
                      <td className="px-2 py-2">
                        {row.link ? (
                          <Link
                            href={appPath(row.link)}
                            aria-label={t("table.open")}
                            title={t("table.open")}
                            className="inline-flex rounded p-0.5 text-muted hover:bg-hover hover:text-body"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                    {open ? (
                      <tr className="border-t border-line bg-surface">
                        <td colSpan={10} className="px-4 py-3">
                          <RowDetail row={row} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && !failed ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="btn-secondary"
          >
            {loadingMore ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {t("loadMore")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Who made a config change: the member's name or email, else the kind of actor. */
function actorOf(actor: { kind: string; name: string | null; email: string | null }): string {
  return actor.name || actor.email || actor.kind;
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-wide text-faint">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── totals ──────────────────────────────────────────────────────────────────

interface BarItem {
  key: string;
  label: string;
  value: number;
  display: string;
  sub?: string | undefined;
}

function TotalsCards({ totals, mcp }: { totals: ActivityTotals; mcp: boolean }) {
  const t = useTranslations("pages.activity");
  const failedSub = (c: OutcomeCounts) =>
    c.error + c.refused > 0 ? t("totals.failedCount", { count: c.error + c.refused }) : undefined;
  const agentLabel = (agent: { id: string; name: string | null } | null) =>
    agent ? (agent.name ?? `${t("totals.deleted")} · ${agent.id.slice(-6)}`) : t("totals.noAgent");
  const calls = (c: OutcomeCounts) => String(c.total);

  const byAgent: BarItem[] = totals.toolCallsByAgent.map((a) => ({
    key: a.agent?.id ?? "",
    label: agentLabel(a.agent),
    value: a.total,
    display: calls(a),
    sub: failedSub(a),
  }));
  const byTool: BarItem[] = totals.toolCallsByTool.map((c) => ({
    key: c.tool,
    label: toolLabel(c.tool),
    value: c.total,
    display: calls(c),
    sub: failedSub(c),
  }));
  const byIntegration: BarItem[] = totals.toolCallsByIntegration.map((c) => ({
    key: `${c.integration.type ?? ""}:${c.integration.id ?? ""}`,
    label: c.integration.name ?? c.integration.type ?? t("totals.noIntegration"),
    value: c.total,
    display: calls(c),
    sub: failedSub(c),
  }));
  const costByAgent: BarItem[] = totals.usageByAgent.map((u) => ({
    key: u.agent?.id ?? "",
    label: agentLabel(u.agent),
    value: u.costUsd,
    display: formatUsd(u.costUsd),
    sub: u.tokens.total ? `${formatTokens(u.tokens.total ?? 0)} ${t("totals.tokens")}` : undefined,
  }));

  const kpis = [
    { label: t("totals.toolCalls"), value: String(totals.toolCalls.total) },
    {
      label: t("totals.failed"),
      value: String(totals.toolCalls.error + totals.toolCalls.refused),
    },
    // Spend is not tied to an integration, so the MCP view counts who and what instead.
    ...(mcp
      ? [
          { label: t("totals.agents"), value: String(totals.toolCallsByAgent.length) },
          { label: t("totals.tools"), value: String(totals.toolCallsByTool.length) },
        ]
      : [
          { label: t("totals.cost"), value: formatUsd(totals.usage.costUsd) },
          { label: t("totals.tokens"), value: formatTokens(totals.usage.tokens.total ?? 0) },
        ]),
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            role="group"
            aria-label={k.label}
            className="rounded-2xl border border-line bg-card p-4"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-faint">{k.label}</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-strong">{k.value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {mcp ? (
          <>
            <BarCard title={t("totals.byAgent")} items={byAgent} />
            <BarCard title={t("totals.byTool")} items={byTool} />
          </>
        ) : (
          <>
            <BarCard title={t("totals.byIntegration")} items={byIntegration} />
            <BarCard title={t("totals.costByAgent")} items={costByAgent} />
          </>
        )}
      </div>
    </div>
  );
}

function BarCard({ title, items }: { title: string; items: BarItem[] }) {
  const t = useTranslations("pages.activity");
  const max = Math.max(...items.map((i) => i.value), 0);
  return (
    <section aria-label={title} className="rounded-2xl border border-line bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-strong">{title}</h2>
      {items.length === 0 ? (
        <p className="text-xs text-faint">{t("totals.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 10).map((item) => (
            <li key={item.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-body" title={item.label}>
                  {item.label}
                </span>
                <span className="shrink-0 font-mono text-muted">
                  {item.display}
                  {item.sub ? (
                    <span className="ml-2 text-[10px] text-faint">{item.sub}</span>
                  ) : null}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-hover">
                <div
                  className="h-full rounded-full bg-violet-500/70"
                  style={{ width: `${max > 0 ? Math.max(2, (item.value / max) * 100) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── detail ──────────────────────────────────────────────────────────────────

function RowDetail({ row }: { row: ActivityRow }) {
  const t = useTranslations("pages.activity");
  const d = row.detail;
  const pairs: Array<[string, React.ReactNode]> = [];
  const add = (label: string, value: React.ReactNode) => {
    if (value !== null && value !== undefined && value !== "") pairs.push([label, value]);
  };
  let json: { label: string; value: unknown } | null = null;
  let error: string | null = null;

  if (row.integration) {
    add(
      t("detail.integration"),
      [row.integration.name, row.integration.type, row.integration.id].filter(Boolean).join(" · ")
    );
  }
  if (row.channel) add(t("detail.channel"), row.channel.name ?? row.channel.id);

  switch (d.kind) {
    case "tool_call":
      add(t("detail.tool"), <code>{d.tool}</code>);
      add(t("detail.source"), d.source);
      add(t("detail.ref"), row.ref);
      add(t("detail.resultSize"), d.resultSize);
      json = { label: t("detail.input"), value: d.input };
      error = d.error ? (d.errorCode ? `${d.errorCode}: ${d.error}` : d.error) : null;
      break;
    case "model_usage":
      add(t("detail.model"), d.model);
      add(t("detail.capability"), d.capability);
      add(t("detail.usageKind"), d.usageKind);
      add(t("detail.tokensIn"), row.tokens?.in);
      add(t("detail.tokensOut"), row.tokens?.out);
      add(t("detail.cacheWrite"), row.tokens?.cacheWrite);
      add(t("detail.cacheRead"), row.tokens?.cacheRead);
      add(t("detail.tokensTotal"), row.tokens?.total);
      if (d.failed) add(t("detail.failed"), t("detail.yes"));
      break;
    case "flow_run":
      add(t("detail.status"), d.status);
      add(t("detail.trigger"), d.triggerSource);
      add(t("detail.steps"), d.steps);
      add(t("detail.tokensTotal"), row.tokens?.total);
      error = d.error;
      break;
    case "conversation":
      add(t("detail.status"), d.status);
      add(t("detail.messages"), d.messageCount);
      if (row.durationMs != null) add(t("detail.duration"), formatDuration(row.durationMs));
      break;
    case "config_change":
      add(t("detail.action"), <code>{d.action}</code>);
      add(
        t("detail.actor"),
        d.actor.name || d.actor.email
          ? [d.actor.name, d.actor.email].filter(Boolean).join(" · ")
          : d.actor.kind
      );
      add(t("detail.target"), `${d.targetType}/${d.targetId}`);
      if (Object.keys(d.meta).length) json = { label: t("detail.meta"), value: d.meta };
      break;
  }

  return (
    <div className="space-y-2 text-xs">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {pairs.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 break-all text-body">{value}</dd>
          </Fragment>
        ))}
      </dl>
      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-300">
          <span className="font-medium">{t("detail.error")}:</span> {error}
        </div>
      ) : null}
      {json ? (
        <div>
          <p className="mb-1 text-muted">{json.label}</p>
          <pre className="max-h-64 overflow-auto rounded-lg bg-black/5 p-2 font-mono text-[11px] text-body dark:bg-black/40">
            {JSON.stringify(json.value, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
