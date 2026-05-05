"use client";

import { motion } from "framer-motion";
import { MessageSquare, Globe, Phone, Hash, Mail, Code } from "lucide-react";
import { APPLE_EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

type ConvStatus = "open" | "closed" | "escalated";
type ChannelType = "web" | "widget" | "whatsapp" | "telegram" | "slack" | "email" | "api";

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

const STATUS_DOT: Record<ConvStatus, string> = {
  open: "bg-blue-400",
  closed: "bg-zinc-600",
  escalated: "bg-red-400",
};

const STATUS_TEXT: Record<ConvStatus, string> = {
  open: "text-blue-400",
  closed: "text-zinc-500",
  escalated: "text-red-400",
};

const CHANNEL_ICONS: Record<ChannelType, React.ReactNode> = {
  web: <Globe size={11} />,
  widget: <Globe size={11} />,
  whatsapp: <Phone size={11} />,
  telegram: <MessageSquare size={11} />,
  slack: <Hash size={11} />,
  email: <Mail size={11} />,
  api: <Code size={11} />,
};

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function ConversationRow({
  employeeName,
  agentName,
  status,
  channelType,
  messageCount,
  durationSeconds,
  startedAt,
  statusLabels,
  channelLabels,
  messagesLabel,
  durationLabel,
}: ConversationRowProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: APPLE_EASE }}
      className={cn(
        "flex items-center gap-4 px-4 py-3",
        "border-b border-white/[0.05] last:border-0",
        "hover:bg-white/[0.025] transition-colors duration-150"
      )}
    >
      {/* Icon */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600/15 text-violet-400">
        <MessageSquare size={13} />
      </div>

      {/* Names */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-200">
          {employeeName ?? "Unknown employee"}
        </p>
        <p className="truncate text-xs text-zinc-500">
          {agentName ?? "Unknown agent"} · {formatTime(startedAt)}
        </p>
      </div>

      {/* Right side metadata */}
      <div className="flex shrink-0 items-center gap-3">
        {/* Channel badge */}
        {channelType && (
          <span className="hidden items-center gap-1 rounded-md border border-zinc-700/50 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400 sm:flex">
            {CHANNEL_ICONS[channelType]}
            {channelLabels[channelType]}
          </span>
        )}

        {/* Status */}
        <div className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
          <span className={cn("text-[11px] font-medium", STATUS_TEXT[status])}>
            {statusLabels[status]}
          </span>
        </div>

        {/* Count */}
        <span className="hidden text-[11px] text-zinc-600 sm:block">
          {messageCount} {messagesLabel}
          {durationSeconds ? ` · ${durationSeconds}${durationLabel}` : ""}
        </span>
      </div>
    </motion.div>
  );
}
