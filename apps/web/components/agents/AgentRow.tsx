"use client";

import { motion } from "framer-motion";
import { Chip } from "@heroui/react";
import { Bot } from "lucide-react";
import { staggerItem } from "@/lib/motion";

interface AgentRowProps {
  name: string;
  role: string;
  model: string;
  status: "active" | "inactive" | "draft";
  teamName: string | null;
  statusLabels: { active: string; inactive: string; draft: string };
}

const STATUS_COLORS = {
  active: "success",
  inactive: "default",
  draft: "warning",
} as const;

export function AgentRow({ name, role, model, status, teamName, statusLabels }: AgentRowProps) {
  return (
    <motion.div
      variants={staggerItem}
      className="flex items-center gap-4 rounded-xl border border-default-100 bg-background p-4 dark:border-white/5 dark:bg-white/[0.02]"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fichap-primary/10 text-fichap-primary">
        <Bot size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-sm text-default-900 dark:text-default-100">
            {name}
          </span>
          <Chip size="sm" variant="flat" color={STATUS_COLORS[status]}>
            {statusLabels[status]}
          </Chip>
        </div>
        <p className="truncate text-xs text-default-500">{role}</p>
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <span className="rounded-md bg-default-100 px-2 py-0.5 font-mono text-[11px] text-default-600 dark:bg-white/10 dark:text-default-300">
          {model}
        </span>
        {teamName && <span className="text-[11px] text-default-400">{teamName}</span>}
      </div>
    </motion.div>
  );
}
