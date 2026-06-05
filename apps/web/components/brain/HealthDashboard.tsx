"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { RefreshCw, Activity } from "lucide-react";
import { Button, Skeleton } from "@heroui/react";
import { useBrainHealthHistory, useBrainHealthLatest } from "@/lib/hooks/use-brain-health";

export interface HealthDashboardProps {
  /** Allows the host page to start collapsed. */
  defaultExpanded?: boolean;
}

interface ChartPoint {
  date: string;
  factsActive: number;
  hitRate: number;
}

export function HealthDashboard({ defaultExpanded = true }: HealthDashboardProps) {
  const t = useTranslations("brain");
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  const latest = useBrainHealthLatest();
  const history = useBrainHealthHistory(30);

  const points: ChartPoint[] = useMemo(() => {
    return (history.history ?? []).map((s) => ({
      date: typeof s.capturedAt === "string" ? s.capturedAt : new Date().toISOString(),
      factsActive: Number(s.factCountActive ?? 0),
      hitRate: Number(s.recallHitRate30d ?? 0),
    }));
  }, [history.history]);

  const gridColor = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";
  const textColor = isDark ? "#52525b" : "#71717a";

  function refresh() {
    void latest.mutate();
    void history.mutate();
  }

  const loading = latest.isLoading || history.isLoading;
  const noData = !loading && points.length === 0;
  const lastRefresh = latest.snapshot?.capturedAt
    ? new Date(latest.snapshot.capturedAt).toLocaleString()
    : null;

  return (
    <section className="rounded-2xl border border-line bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-sm font-semibold text-strong"
          aria-expanded={expanded}
        >
          <Activity className="h-4 w-4 text-violet-500" />
          {t("health.title")}
        </button>
        <div className="flex items-center gap-2">
          {lastRefresh ? (
            <span className="text-[11px] text-faint">
              {t("health.lastRefresh", { when: lastRefresh })}
            </span>
          ) : null}
          <Button
            size="sm"
            variant="light"
            onPress={refresh}
            startContent={<RefreshCw className="h-3.5 w-3.5" />}
            isLoading={loading}
          >
            {t("actions.refreshNow")}
          </Button>
        </div>
      </header>

      {expanded ? (
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-elevated/40 p-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              {t("health.factCountActive")}
            </h3>
            {loading ? (
              <Skeleton className="h-44 w-full rounded-lg" />
            ) : noData ? (
              <EmptyChart label={t("stats.noData")} />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v: string) => {
                      const d = new Date(v);
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                    tick={{ fill: textColor, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: textColor, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle(isDark)}
                    labelFormatter={(v) =>
                      new Date(String(v)).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="factsActive"
                    stroke="#7C3AED"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "#7C3AED", strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="rounded-xl border border-line bg-elevated/40 p-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              {t("health.recallHitRate")}
            </h3>
            {loading ? (
              <Skeleton className="h-44 w-full rounded-lg" />
            ) : noData ? (
              <EmptyChart label={t("stats.noData")} />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v: string) => {
                      const d = new Date(v);
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                    tick={{ fill: textColor, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: textColor, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    domain={[0, 1]}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle(isDark)}
                    formatter={(value) => `${(Number(value) * 100).toFixed(1)}%`}
                    labelFormatter={(v) =>
                      new Date(String(v)).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="hitRate"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "#10b981", strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function tooltipStyle(isDark: boolean) {
  return {
    backgroundColor: isDark ? "#18181b" : "#fff",
    border: `1px solid ${isDark ? "rgba(124,58,237,0.2)" : "rgba(0,0,0,0.08)"}`,
    borderRadius: "10px",
    fontSize: "11px",
    color: isDark ? "#e4e4e7" : "#09090b",
    boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.4)" : "0 4px 16px rgba(0,0,0,0.1)",
  } as const;
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-44 items-center justify-center">
      <p className="text-xs text-faint">{label}</p>
    </div>
  );
}
