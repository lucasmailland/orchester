"use client";

import { motion } from "framer-motion";
import { Chip } from "@heroui/react";
import { MessageSquare, Globe, Phone } from "lucide-react";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

type ConvStatus = "open" | "closed" | "escalated";
type ChannelType = "web" | "whatsapp" | "telegram";

interface ConversationRowProps {
  employeeName: string | null;
  agentName: string | null;
  status: ConvStatus;
  channelType: ChannelType | null;
  messageCount: number;
  durationSeconds: number | null;
  startedAt: Date;
  statusLabels: Record<ConvStatus, string>;
  channelLabels: Record<ChannelType, string>;
  messagesLabel: string;
  durationLabel: string;
}

const STATUS_COLORS = {
  open: "primary",
  closed: "default",
  escalated: "danger",
} as const;

const CHANNEL_ICONS: Record<ChannelType, React.ReactNode> = {
  web: <Globe size={12} />,
  whatsapp: <Phone size={12} />,
  telegram: <MessageSquare size={12} />,
};

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(date));
}

export function ConversationRow({
  employeeName, agentName, status, channelType, messageCount, durationSeconds,
  startedAt, statusLabels, channelLabels, messagesLabel, durationLabel,
}: ConversationRowProps) {
  return (
    <motion.div
      variants={staggerItem}
      className={cn(
        "flex items-center gap-4 px-4 py-3",
        "border-b border-default-100 last:border-0 dark:border-white/5",
        "bg-background hover:bg-default-50 dark:bg-transparent dark:hover:bg-white/[0.02]"
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fichap-primary/10 text-fichap-primary">
        <MessageSquare size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-default-900 dark:text-default-100">
          {employeeName ?? "Unknown employee"}
        </p>
        <p className="truncate text-xs text-default-500">
          {agentName ?? "Unknown agent"} · {formatTime(startedAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {channelType && (
          <Chip
            size="sm"
            variant="flat"
            startContent={CHANNEL_ICONS[channelType]}
            classNames={{ base: "gap-1 text-[11px]" }}
          >
            {channelLabels[channelType]}
          </Chip>
        )}
        <Chip size="sm" color={STATUS_COLORS[status]} variant="flat">
          {statusLabels[status]}
        </Chip>
        <span className="hidden text-[11px] text-default-400 sm:block">
          {messageCount} {messagesLabel}
          {durationSeconds ? ` · ${durationSeconds}${durationLabel}` : ""}
        </span>
      </div>
    </motion.div>
  );
}
