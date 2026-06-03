"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import {
  MessageCircle,
  Send,
  Hash,
  Mail,
  Globe,
  Webhook,
  Zap,
  Bot,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";

type Channel = {
  key: "whatsapp" | "telegram" | "slack" | "email" | "web" | "webhook" | "api" | "more";
  Icon: LucideIcon;
  color: string;
  bg: string;
  glow: string;
  stat?: string;
};

// Order matches a 3x3 grid: row1 row2 row3 left-to-right, with the center cell being the AGENT
const CELLS: (Channel | "agent")[] = [
  {
    key: "whatsapp",
    Icon: MessageCircle,
    color: "text-emerald-400",
    bg: "from-emerald-500/15 to-transparent border-emerald-500/30",
    glow: "shadow-emerald-500/20",
    stat: "847 convs",
  },
  {
    key: "telegram",
    Icon: Send,
    color: "text-sky-400",
    bg: "from-sky-500/15 to-transparent border-sky-500/30",
    glow: "shadow-sky-500/20",
    stat: "1.2k msgs",
  },
  {
    key: "slack",
    Icon: Hash,
    color: "text-fuchsia-400",
    bg: "from-fuchsia-500/15 to-transparent border-fuchsia-500/30",
    glow: "shadow-fuchsia-500/20",
    stat: "312 convs",
  },
  {
    key: "email",
    Icon: Mail,
    color: "text-amber-400",
    bg: "from-amber-500/15 to-transparent border-amber-500/30",
    glow: "shadow-amber-500/20",
    stat: "94 threads",
  },
  "agent",
  {
    key: "web",
    Icon: Globe,
    color: "text-cyan-400",
    bg: "from-cyan-500/15 to-transparent border-cyan-500/30",
    glow: "shadow-cyan-500/20",
    stat: "2.4k visits",
  },
  {
    key: "webhook",
    Icon: Webhook,
    color: "text-indigo-400",
    bg: "from-indigo-500/15 to-transparent border-indigo-500/30",
    glow: "shadow-indigo-500/20",
    stat: "5.6k events",
  },
  {
    key: "api",
    Icon: Zap,
    color: "text-yellow-400",
    bg: "from-yellow-500/15 to-transparent border-yellow-500/30",
    glow: "shadow-yellow-500/20",
    stat: "12.4k req/d",
  },
  {
    key: "more",
    Icon: MoreHorizontal,
    color: "text-zinc-400",
    bg: "from-zinc-700/30 to-transparent border-zinc-700/50",
    glow: "shadow-zinc-700/20",
    stat: "+ custom",
  },
];

function ChannelCard({
  channel,
  t,
  delay,
}: {
  channel: Channel;
  t: (k: string) => string;
  delay: number;
}) {
  const { key, Icon, color, bg, glow, stat } = channel;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.95 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ delay, duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
      whileHover={{ scale: 1.03, transition: { duration: 0.2 } }}
      className={`group relative flex flex-col items-center justify-center gap-3 rounded-2xl border bg-gradient-to-br ${bg} p-5 shadow-lg ${glow} backdrop-blur-sm cursor-default min-h-[150px]`}
    >
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900/60 ${color} transition-transform duration-300 group-hover:scale-110`}
      >
        <Icon size={22} />
      </div>
      <div className="text-center">
        <p className={`font-display text-sm font-semibold ${color}`}>
          {key === "more" ? "+ more" : t(`labels.${key}`)}
        </p>
        {stat && <p className="mt-0.5 font-mono text-[10px] text-zinc-500">{stat}</p>}
      </div>
    </motion.div>
  );
}

function AgentCard({ delay }: { delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.55, ease: [0.22, 0.61, 0.36, 1] }}
      className="relative flex flex-col items-center justify-center gap-3 rounded-2xl border border-violet-500/50 bg-gradient-to-br from-violet-600 to-indigo-600 p-5 shadow-2xl shadow-violet-500/40 min-h-[150px]"
    >
      <div className="absolute -inset-3 -z-10 rounded-3xl bg-violet-500/30 blur-2xl" />
      <div className="absolute -inset-1 -z-10 rounded-2xl bg-gradient-to-br from-violet-500/40 to-indigo-500/40 blur-md" />
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-zinc-900/40 backdrop-blur-sm">
        <Bot size={28} className="text-white" />
      </div>
      <div className="text-center">
        <p className="font-display text-base font-bold text-white">Agent</p>
        <p className="mt-0.5 font-mono text-[10px] text-violet-200/80">claude-opus-4</p>
      </div>
      {/* status pill */}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-zinc-900/60 px-1.5 py-0.5 backdrop-blur-sm">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        <span className="text-[9px] font-medium uppercase tracking-wider text-emerald-200">
          live
        </span>
      </div>
    </motion.div>
  );
}

export function ChannelsSection() {
  const t = useTranslations("marketing.channels");
  return (
    <section className="relative overflow-hidden py-24">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/8 blur-[140px]" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-12 text-center"
        >
          <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t("title")}{" "}
            <span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-cyan-400 bg-clip-text text-transparent">
              {t("titleAccent")}
            </span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-zinc-500">{t("subtitle")}</p>
        </motion.div>

        {/* 3x3 Grid */}
        <div className="mx-auto grid max-w-3xl grid-cols-3 gap-3">
          {CELLS.map((cell, i) => {
            const delay = 0.05 * i;
            if (cell === "agent") return <AgentCard key="agent" delay={delay} />;
            return (
              <ChannelCard
                key={cell.key}
                channel={cell}
                t={t as (k: string) => string}
                delay={delay}
              />
            );
          })}
        </div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-6 sm:gap-12"
        >
          <div className="text-center">
            <div className="font-display text-3xl font-bold text-white">7</div>
            <div className="mt-0.5 text-xs uppercase tracking-wider text-zinc-500">
              {t("statChannels")}
            </div>
          </div>
          <div className="hidden h-8 w-px bg-zinc-800 sm:block" />
          <div className="text-center">
            <div className="font-display text-3xl font-bold text-white">1</div>
            <div className="mt-0.5 text-xs uppercase tracking-wider text-zinc-500">
              {t("statContext")}
            </div>
          </div>
          <div className="hidden h-8 w-px bg-zinc-800 sm:block" />
          <div className="text-center">
            <div className="font-display text-3xl font-bold text-white">0</div>
            <div className="mt-0.5 text-xs uppercase tracking-wider text-zinc-500">
              {t("statSync")}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
