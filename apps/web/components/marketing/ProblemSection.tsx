"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { AlertCircle, Workflow, Eye, Bot, Users } from "lucide-react";

const PROBLEMS = [
  {
    key: "confused",
    Icon: AlertCircle,
    color: "text-violet-400 bg-violet-500/10 border-violet-500/30",
  },
  {
    key: "slow",
    Icon: Workflow,
    color: "text-violet-400 bg-violet-500/10 border-violet-500/30",
  },
  {
    key: "blind",
    Icon: Eye,
    color: "text-violet-400 bg-violet-500/10 border-violet-500/30",
  },
] as const;

function SingleAgentMockup() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8">
      <span className="absolute right-3 top-3 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        Before
      </span>
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/30">
        <Bot size={36} className="text-zinc-400" />
      </div>
      <div className="mt-2 text-center">
        <p className="text-sm font-semibold text-zinc-200">One agent. Twelve jobs.</p>
        <p className="mt-1 text-xs text-zinc-500">Context overflow. Drift. Hallucination.</p>
      </div>
      {/* "Tasks" floating around it */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
        {["billing", "support", "lead", "search", "report", "+8"].map((task) => (
          <span
            key={task}
            className="rounded-md border border-zinc-700/60 bg-zinc-900/60 px-1.5 py-0.5 text-[10px] text-zinc-500"
          >
            {task}
          </span>
        ))}
      </div>
    </div>
  );
}

function TeamMockup() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8">
      <span className="absolute right-3 top-3 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        After
      </span>
      {/* Orchestrator */}
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10 shadow-2xl shadow-black/30">
        <Users size={20} className="text-violet-400" />
      </div>
      {/* Connecting lines + specialists */}
      <svg width="200" height="32" viewBox="0 0 200 32" className="-my-1" aria-hidden="true">
        <path
          d="M 100 0 V 16 H 30 V 30"
          stroke="#52525b"
          strokeWidth="1"
          strokeDasharray="2 2"
          fill="none"
        />
        <path
          d="M 100 16 H 100 V 30"
          stroke="#52525b"
          strokeWidth="1"
          strokeDasharray="2 2"
          fill="none"
        />
        <path
          d="M 100 16 H 170 V 30"
          stroke="#52525b"
          strokeWidth="1"
          strokeDasharray="2 2"
          fill="none"
        />
      </svg>
      <div className="flex items-start gap-3">
        {[
          {
            label: "Sales",
            color: "text-zinc-300 border-zinc-700 bg-zinc-800/60",
          },
          {
            label: "Support",
            color: "text-zinc-300 border-zinc-700 bg-zinc-800/60",
          },
          {
            label: "Ops",
            color: "text-zinc-300 border-zinc-700 bg-zinc-800/60",
          },
        ].map((s) => (
          <div
            key={s.label}
            className={`flex h-8 w-12 items-center justify-center rounded-md border ${s.color} text-[10px] font-medium`}
          >
            {s.label}
          </div>
        ))}
      </div>
      <div className="mt-2 text-center">
        <p className="text-sm font-semibold text-zinc-200">A team. One job each.</p>
        <p className="mt-1 text-xs text-zinc-500">Routed. Parallel. Traceable.</p>
      </div>
    </div>
  );
}

export function ProblemSection() {
  const t = useTranslations("marketing.problem");

  return (
    <section className="border-y border-zinc-800/40 bg-zinc-950/30 py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          className="mb-16 text-center"
        >
          <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            {t("eyebrow")}
          </p>
          <h2 className="font-display text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl">
            {t("title1")} <span className="text-zinc-500">{t("title2")}</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-400">
            {t("subtitle")}
          </p>
        </motion.div>

        {/* Comparison */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1], delay: 0.1 }}
          className="grid gap-4 md:grid-cols-2"
        >
          <SingleAgentMockup />
          <TeamMockup />
        </motion.div>

        {/* 3 pain points */}
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PROBLEMS.map(({ key, Icon, color }, i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6"
            >
              <div
                className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border ${color}`}
              >
                <Icon size={16} />
              </div>
              <h3 className="mb-1.5 text-base font-semibold text-zinc-100">
                {t(`points.${key}.title`)}
              </h3>
              <p className="text-base leading-relaxed text-zinc-400">{t(`points.${key}.desc`)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
