"use client";

import { motion } from "framer-motion";
import { Bot } from "lucide-react";
import { Chip } from "@heroui/react";
import { cn } from "@/lib/utils";
import { cardHover } from "@/lib/motion";

interface TeamCardProps {
  name: string;
  description: string | null;
  avatarColor: string | null;
  agentCount: number;
  agentsLabel: string;
}

export function TeamCard({ name, description, avatarColor, agentCount, agentsLabel }: TeamCardProps) {
  const color = avatarColor ?? "#3B3BFF";

  return (
    <motion.div
      variants={cardHover}
      initial="rest"
      whileHover="hover"
      className={cn(
        "cursor-pointer rounded-2xl border border-default-100 bg-background p-5",
        "transition-colors dark:border-white/5 dark:bg-white/[0.02]"
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white text-lg font-bold"
          style={{ backgroundColor: color }}
        >
          {name[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="truncate font-semibold text-default-900 dark:text-default-100">{name}</h3>
          {description && (
            <p className="line-clamp-2 text-xs text-default-500">{description}</p>
          )}
          <Chip
            size="sm"
            variant="flat"
            color="primary"
            startContent={<Bot size={11} />}
            classNames={{ base: "gap-1 mt-1" }}
          >
            {agentCount} {agentsLabel}
          </Chip>
        </div>
      </div>
    </motion.div>
  );
}
