"use client";

import { motion } from "framer-motion";
import { Bot, Radio, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { APPLE_EASE, useReveal } from "@/lib/motion";

interface TeamCardProps {
  id: string;
  name: string;
  description: string | null;
  avatarColor: string | null;
  agentCount: number;
  channelCount: number;
  locale: string;
  workspaceSlug: string;
}

export function TeamCard({
  id,
  name,
  description,
  avatarColor,
  agentCount,
  channelCount,
  locale,
  workspaceSlug,
}: TeamCardProps) {
  const t = useTranslations("pages.teams");
  const reveal = useReveal();
  const color = avatarColor ?? "#7C3AED";
  // `w[0]` returns a single UTF-16 *code unit*. For team names like
  // "🎯 Comercial" the first word is the emoji "🎯" (U+1F3AF), encoded
  // in UTF-16 as the surrogate pair 🎯 — so `w[0]` produces a
  // lone high surrogate, which React serializes one way on the server
  // and another way on the client → "Hydration failed because the
  // server rendered text didn't match the client" on every team card.
  // Iterating with the string iterator gives full Unicode code points,
  // so emojis stay intact and ASCII initials still get uppercased.
  const initials = name
    .split(" ")
    .map((w) => [...w][0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={reveal === "visible" ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      transition={{ duration: 0.35, ease: APPLE_EASE }}
      whileHover={{ y: -3, transition: { duration: 0.18 } }}
    >
      <Link
        href={`/${locale}/${workspaceSlug}/teams/${id}`}
        className={cn(
          "group relative block overflow-hidden rounded-2xl",
          "border border-line bg-card",
          "hover:border-line hover:bg-white/[0.055]",
          "transition-all duration-200"
        )}
      >
        {/* Top accent gradient */}
        <div
          className="h-[2px] w-full"
          style={{
            background: `linear-gradient(90deg, ${color}70 0%, ${color}28 60%, transparent 100%)`,
          }}
        />

        <div className="p-5">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold shadow-md"
              style={{
                backgroundColor: `${color}1a`,
                border: `1px solid ${color}35`,
                color,
              }}
            >
              {initials}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold text-strong">{name}</h3>
                <ChevronRight
                  size={14}
                  className="shrink-0 text-faint transition-colors group-hover:text-muted"
                />
              </div>
              {description && (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                  {description}
                </p>
              )}
              {/* Stats row */}
              <div className="mt-3 flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <Bot size={11} className="text-faint" />
                  <span className="font-semibold text-body">{agentCount}</span>{" "}
                  {agentCount === 1 ? t("agent") : t("agents")}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <Radio size={11} className="text-faint" />
                  <span className="font-semibold text-body">{channelCount}</span>{" "}
                  {channelCount === 1 ? t("channel") : t("channels")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
