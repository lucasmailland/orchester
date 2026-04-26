"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { staggerItem } from "@/lib/motion";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: "primary" | "accent" | "success" | "warning";
  className?: string;
}

const COLOR_MAP = {
  primary: { bg: "bg-fichap-primary/10 dark:bg-fichap-primary/20", icon: "text-fichap-primary" },
  accent: { bg: "bg-fichap-accent/10 dark:bg-fichap-accent/20", icon: "text-fichap-accent" },
  success: { bg: "bg-fichap-success/10 dark:bg-fichap-success/20", icon: "text-fichap-success" },
  warning: { bg: "bg-fichap-warning/10 dark:bg-fichap-warning/20", icon: "text-fichap-warning" },
};

export function KpiCard({ label, value, icon, color = "primary", className }: KpiCardProps) {
  const colors = COLOR_MAP[color];

  return (
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "rounded-2xl border border-default-100 bg-background p-5",
        "shadow-sm transition-shadow hover:shadow-md",
        "dark:border-white/5 dark:bg-white/[0.02]",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-default-400">{label}</p>
          <p className="text-3xl font-bold tracking-tight text-default-900 dark:text-default-100">
            {value}
          </p>
        </div>
        <div className={cn("rounded-xl p-2.5", colors.bg)}>
          <div className={cn("h-5 w-5", colors.icon)}>{icon}</div>
        </div>
      </div>
    </motion.div>
  );
}
