"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

interface DataPoint {
  date: string;
  count: number;
}

interface ConversationChartProps {
  data: DataPoint[];
  noDataLabel: string;
}

export function ConversationChart({ data, noDataLabel }: ConversationChartProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  if (!data.length) {
    return (
      <div className="flex h-52 items-center justify-center">
        <p className="text-xs text-zinc-600">{noDataLabel}</p>
      </div>
    );
  }

  const gridColor = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";
  const textColor = isDark ? "#52525b" : "#71717a";

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="cvGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#7C3AED" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis
          dataKey="date"
          tick={{ fill: textColor, fontSize: 10, fontFamily: "var(--font-geist-mono)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => {
            const d = new Date(v);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: textColor, fontSize: 10, fontFamily: "var(--font-geist-mono)" }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: isDark ? "#18181b" : "#fff",
            border: `1px solid ${isDark ? "rgba(124,58,237,0.2)" : "rgba(0,0,0,0.08)"}`,
            borderRadius: "10px",
            fontSize: "11px",
            fontFamily: "var(--font-geist-mono)",
            color: isDark ? "#e4e4e7" : "#09090b",
            boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.4)" : "0 4px 16px rgba(0,0,0,0.1)",
          }}
          labelFormatter={(v) => {
            const d = new Date(String(v));
            return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#7C3AED"
          strokeWidth={2}
          fill="url(#cvGradient)"
          dot={false}
          activeDot={{ r: 4, fill: "#7C3AED", strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
