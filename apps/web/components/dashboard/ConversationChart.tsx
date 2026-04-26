"use client";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useTheme } from "next-themes";

interface DataPoint { date: string; count: number }

interface ConversationChartProps {
  data: DataPoint[];
  noDataLabel: string;
}

export function ConversationChart({ data, noDataLabel }: ConversationChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  if (!data.length) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className="text-sm text-default-400">{noDataLabel}</p>
      </div>
    );
  }

  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const textColor = isDark ? "#a1a1aa" : "#71717a";

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="cvGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3B3BFF" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#3B3BFF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis
          dataKey="date"
          tick={{ fill: textColor, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => {
            const d = new Date(v);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: textColor, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: isDark ? "#18181b" : "#fff",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
            borderRadius: "12px",
            fontSize: "12px",
            color: isDark ? "#fafafa" : "#09090b",
          }}
          labelFormatter={(v) => {
            const d = new Date(String(v));
            return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#3B3BFF"
          strokeWidth={2}
          fill="url(#cvGradient)"
          dot={false}
          activeDot={{ r: 4, fill: "#3B3BFF" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
