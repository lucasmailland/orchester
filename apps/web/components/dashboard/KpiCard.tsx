"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { APPLE_EASE } from "@/lib/motion";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: "primary" | "accent" | "success" | "warning";
  className?: string;
}

const CARD_BG: Record<NonNullable<KpiCardProps["color"]>, string> = {
  primary: "bg-card border-line",
  accent: "bg-violet-600 border-violet-500/40",
  success: "bg-blue-600 border-blue-500/40",
  warning: "bg-teal-600 border-teal-500/40",
};

const ICON_BG: Record<NonNullable<KpiCardProps["color"]>, string> = {
  primary: "bg-hover",
  accent: "bg-white/20",
  success: "bg-white/20",
  warning: "bg-white/20",
};

function DecorShapes({ color }: { color: NonNullable<KpiCardProps["color"]> }) {
  const isPrimary = color === "primary";
  return (
    <svg
      className="pointer-events-none absolute right-0 top-0 h-full w-[60%]"
      viewBox="0 0 170 130"
      fill="none"
      aria-hidden
    >
      <circle
        cx="130"
        cy="-15"
        r="85"
        fill={isPrimary ? "#7C3AED" : "#fff"}
        fillOpacity={isPrimary ? "0.07" : "0.09"}
      />
      <circle
        cx="158"
        cy="115"
        r="55"
        fill={isPrimary ? "#3B3BFF" : "#fff"}
        fillOpacity={isPrimary ? "0.06" : "0.06"}
      />
      <rect
        x="70"
        y="15"
        width="55"
        height="55"
        rx="10"
        transform="rotate(28 70 15)"
        fill="#fff"
        fillOpacity={isPrimary ? "0.03" : "0.04"}
      />
    </svg>
  );
}

export function KpiCard({ label, value, icon, color = "primary", className }: KpiCardProps) {
  // El variant "primary" usa bg-surface (theme-aware) → texto con tokens. Los
  // variants de color tienen fondo saturado oscuro → texto blanco fijo (OK en
  // ambos temas).
  const isPrimary = color === "primary";
  const labelCls = isPrimary ? "text-muted" : "text-white/60";
  const iconCls = isPrimary ? "text-violet-600 dark:text-violet-400" : "text-white/80";
  const valueCls = isPrimary ? "text-strong" : "text-white";
  const liveCls = isPrimary ? "text-faint" : "text-white/40";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: APPLE_EASE }}
      whileHover={{ y: -3, transition: { duration: 0.18 } }}
      className={cn(
        "relative cursor-default overflow-hidden rounded-2xl border p-5 shadow-xl",
        CARD_BG[color],
        className
      )}
    >
      <DecorShapes color={color} />

      <div className="relative z-10">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("text-[11px] font-semibold uppercase tracking-widest", labelCls)}>
            {label}
          </p>
          <div className={cn("shrink-0 rounded-xl p-2.5", ICON_BG[color])}>
            <div className={cn("h-4 w-4", iconCls)}>{icon}</div>
          </div>
        </div>

        <p
          className={cn(
            "mt-3 font-mono text-[2.1rem] font-bold leading-none tracking-tight",
            valueCls
          )}
        >
          {value}
        </p>
      </div>

      <div className="relative z-10 mt-4 border-t border-line pt-2.5">
        <span className={cn("text-[10px] font-medium uppercase tracking-wider", liveCls)}>
          Live
        </span>
      </div>
    </motion.div>
  );
}
