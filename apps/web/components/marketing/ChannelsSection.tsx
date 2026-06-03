"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { MessageCircle, Send, Hash, Mail, Globe, Webhook, Zap, Bot } from "lucide-react";

const CHANNELS = [
  {
    key: "whatsapp",
    Icon: MessageCircle,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    glow: "shadow-emerald-500/30",
  },
  {
    key: "telegram",
    Icon: Send,
    color: "text-sky-400",
    bg: "bg-sky-500/10 border-sky-500/30",
    glow: "shadow-sky-500/30",
  },
  {
    key: "slack",
    Icon: Hash,
    color: "text-fuchsia-400",
    bg: "bg-fuchsia-500/10 border-fuchsia-500/30",
    glow: "shadow-fuchsia-500/30",
  },
  {
    key: "email",
    Icon: Mail,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30",
    glow: "shadow-amber-500/30",
  },
  {
    key: "web",
    Icon: Globe,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10 border-cyan-500/30",
    glow: "shadow-cyan-500/30",
  },
  {
    key: "webhook",
    Icon: Webhook,
    color: "text-indigo-400",
    bg: "bg-indigo-500/10 border-indigo-500/30",
    glow: "shadow-indigo-500/30",
  },
  {
    key: "api",
    Icon: Zap,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/30",
    glow: "shadow-yellow-500/30",
  },
] as const;

export function ChannelsSection() {
  const t = useTranslations("marketing.channels");
  const RADIUS = 240;
  const angleStep = (2 * Math.PI) / CHANNELS.length;

  return (
    <section className="relative overflow-hidden py-24">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/5 blur-[120px]" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
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

        {/* Orbit container */}
        <div className="relative mx-auto h-[640px] w-full max-w-[640px]">
          {/* SVG connection lines */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 640 640"
            fill="none"
          >
            {CHANNELS.map((_, i) => {
              const angle = i * angleStep - Math.PI / 2;
              const x = 320 + RADIUS * Math.cos(angle);
              const y = 320 + RADIUS * Math.sin(angle);
              return (
                <motion.line
                  key={i}
                  x1={320}
                  y1={320}
                  x2={x}
                  y2={y}
                  stroke="url(#orbitGradient)"
                  strokeWidth={1}
                  strokeDasharray="4 6"
                  initial={{ pathLength: 0, opacity: 0 }}
                  whileInView={{ pathLength: 1, opacity: 0.4 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.07, duration: 0.7 }}
                />
              );
            })}
            {/* Animated message beams — dots traveling from agent center to each channel */}
            {CHANNELS.map((_, i) => {
              const angle = i * angleStep - Math.PI / 2;
              const endX = 320 + RADIUS * Math.cos(angle);
              const endY = 320 + RADIUS * Math.sin(angle);
              return (
                <motion.circle
                  key={`beam-${i}`}
                  r={3.5}
                  fill="#c4b5fd"
                  filter="url(#orbitGlow)"
                  initial={{ cx: 320, cy: 320, opacity: 0 }}
                  animate={{
                    cx: [320, endX],
                    cy: [320, endY],
                    opacity: [0, 1, 1, 0],
                  }}
                  transition={{
                    duration: 1.6,
                    repeat: Infinity,
                    repeatDelay: 1.8,
                    delay: 1 + i * 0.3,
                    ease: "easeOut",
                    times: [0, 0.15, 0.85, 1],
                  }}
                />
              );
            })}
            <defs>
              <linearGradient id="orbitGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#22d3ee" />
              </linearGradient>
              <filter id="orbitGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
          </svg>

          {/* Center: agent */}
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            <div className="relative">
              <div className="absolute -inset-6 animate-pulse rounded-full bg-violet-500/20 blur-2xl" />
              <div className="relative flex h-24 w-24 items-center justify-center rounded-2xl border border-violet-500/40 bg-gradient-to-br from-violet-600 to-indigo-600 shadow-2xl shadow-violet-500/40">
                <Bot size={36} className="text-white" />
              </div>
              <p className="mt-3 text-center font-display text-sm font-semibold text-zinc-200">
                Agent
              </p>
            </div>
          </motion.div>

          {/* Orbiting channels */}
          {CHANNELS.map((ch, i) => {
            const angle = i * angleStep - Math.PI / 2;
            const x = RADIUS * Math.cos(angle);
            const y = RADIUS * Math.sin(angle);
            return (
              <motion.div
                key={ch.key}
                initial={{ opacity: 0, scale: 0.4 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 + i * 0.08, duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
                className="absolute left-1/2 top-1/2"
                style={{ x: x - 36, y: y - 36 }}
              >
                <motion.div
                  animate={{ y: [0, -8, 0] }}
                  transition={{
                    duration: 3 + i * 0.3,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.2,
                  }}
                  className={`group flex h-[72px] w-[72px] flex-col items-center justify-center gap-1 rounded-2xl border ${ch.bg} shadow-lg ${ch.glow} backdrop-blur-sm transition-all hover:scale-110`}
                >
                  <ch.Icon size={22} className={ch.color} />
                  <span className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">
                    {t(`labels.${ch.key}`)}
                  </span>
                </motion.div>
              </motion.div>
            );
          })}
        </div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-6 sm:gap-12"
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
