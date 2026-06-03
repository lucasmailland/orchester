"use client";

import { useTranslations, useLocale } from "next-intl";
import { motion } from "framer-motion";
import { ArrowRight, Star, Zap } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const GithubSVG = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

function AgentCard({
  label,
  model,
  msgs,
  status,
  delay,
}: {
  label: string;
  model: string;
  msgs: string;
  status: "active" | "idle" | "online";
  delay: number;
}) {
  const dotColor = { active: "bg-violet-400", idle: "bg-zinc-600", online: "bg-emerald-400" }[
    status
  ];
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
      className="flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/70 px-3 py-2.5 backdrop-blur-sm"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 font-display text-xs font-bold text-violet-400">
        {label[0]}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-zinc-200">{label}</p>
        <p className="text-[10px] text-zinc-600">{model}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-[10px] text-zinc-600">{msgs}</span>
        <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
      </div>
    </motion.div>
  );
}

export function HeroSection() {
  const t = useTranslations("marketing.hero");
  const locale = useLocale();

  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 pt-16 sm:px-6">
      {/* Dot grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: "radial-gradient(circle, #a78bfa 1px, transparent 1px)",
          backgroundSize: "30px 30px",
        }}
      />
      {/* Ambient orbs */}
      <div className="pointer-events-none absolute left-1/4 top-1/4 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/6 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-1/4 right-1/4 h-[400px] w-[400px] rounded-full bg-indigo-500/5 blur-[100px]" />

      <div className="relative z-10 mx-auto max-w-5xl text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-violet-500/20 bg-violet-500/5 px-4 py-1.5"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-xs font-medium tracking-wide text-violet-300">{t("badge")}</span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.65, ease: [0.22, 0.61, 0.36, 1] }}
          className="mb-6 font-display text-5xl font-bold leading-[1.08] tracking-tight text-white sm:text-6xl md:text-7xl"
        >
          {t("headline1")}
          <br />
          <span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-cyan-400 bg-clip-text text-transparent">
            {t("headline2")}
          </span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.28, duration: 0.5 }}
          className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-zinc-400 sm:text-xl"
        >
          {t("subheadline")}
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38, duration: 0.5 }}
          className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
        >
          <Link
            href={`/${locale}/signup`}
            className={cn(
              "group flex items-center gap-2 rounded-xl px-7 py-3.5 text-sm font-semibold text-white",
              "bg-gradient-to-r from-violet-600 to-indigo-600",
              "shadow-xl shadow-violet-500/25 transition-all duration-200",
              "hover:scale-[1.02] hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-500/40"
            )}
          >
            <Zap size={14} />
            {t("ctaPrimary")}
            <ArrowRight
              size={14}
              className="transition-transform duration-150 group-hover:translate-x-0.5"
            />
          </Link>

          <a
            href="https://github.com/lucasmailland/orchester"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "group flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-7 py-3.5 text-sm font-medium text-zinc-300",
              "transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"
            )}
          >
            <GithubSVG />
            {t("ctaGithub")}
            <span className="flex items-center gap-1 rounded-md bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500 transition-colors group-hover:text-zinc-300">
              <Star size={10} className="text-amber-400" />
              <span className="hidden sm:inline">GitHub</span>
            </span>
          </a>
        </motion.div>

        {/* Agent org preview */}
        <motion.div
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.52, duration: 0.8, ease: [0.22, 0.61, 0.36, 1] }}
          className="mx-auto mt-16 max-w-2xl"
        >
          <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 shadow-2xl shadow-black/50 backdrop-blur-sm">
            {/* Window chrome */}
            <div className="mb-4 flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-red-500/50" />
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500/50" />
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/50" />
              </div>
              <div className="ml-2 flex h-5 flex-1 items-center rounded-md bg-zinc-800/60 px-2">
                <span className="text-[10px] text-zinc-600">
                  orchester.app / workspace / agents
                </span>
              </div>
            </div>
            {/* Agent tree */}
            <div className="space-y-2">
              <AgentCard
                label="Orchestrator"
                model="claude-opus-4"
                msgs="2.4k msgs"
                status="active"
                delay={0.65}
              />
              <div className="ml-5 space-y-2 border-l border-zinc-800 pl-4">
                <AgentCard
                  label="Support"
                  model="claude-sonnet"
                  msgs="847 convs"
                  status="online"
                  delay={0.72}
                />
                <AgentCard
                  label="Analytics"
                  model="gpt-4o"
                  msgs="1.2k convs"
                  status="online"
                  delay={0.79}
                />
                <AgentCard
                  label="Sales"
                  model="claude-haiku"
                  msgs="312 convs"
                  status="idle"
                  delay={0.86}
                />
              </div>
            </div>
            {/* Fade out */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 rounded-b-2xl bg-gradient-to-t from-[#09090B] to-transparent" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
