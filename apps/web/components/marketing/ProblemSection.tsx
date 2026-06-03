"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { AlertCircle, Workflow, Eye, Bot, Users } from "lucide-react";

const PROBLEMS = [
  { key: "confused", Icon: AlertCircle },
  { key: "slow", Icon: Workflow },
  { key: "blind", Icon: Eye },
] as const;

function SingleAgentMockup() {
  const t = useTranslations("marketing.problem");
  return (
    <div className="relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
      <span className="absolute right-3 top-3 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {t("compare.before")}
      </span>
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/30">
        <Bot size={30} className="text-zinc-400" />
      </div>
      <div className="mt-2 text-center">
        <p className="text-sm font-semibold text-zinc-200">{t("compare.singleTitle")}</p>
        <p className="mt-1 text-xs text-zinc-500">{t("compare.singleSub")}</p>
      </div>
    </div>
  );
}

function TeamMockup() {
  const t = useTranslations("marketing.problem");
  return (
    <div className="relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
      <span className="absolute right-3 top-3 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {t("compare.after")}
      </span>
      {/* Orchestrator */}
      <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10 shadow-2xl shadow-black/30">
        <Users size={20} className="text-violet-400" />
      </div>
      {/* Connecting lines + specialists */}
      <svg width="200" height="28" viewBox="0 0 200 28" className="-my-1" aria-hidden="true">
        <path
          d="M 100 0 V 14 H 30 V 26"
          stroke="#52525b"
          strokeWidth="1"
          strokeDasharray="2 2"
          fill="none"
        />
        <path
          d="M 100 14 H 100 V 26"
          stroke="#52525b"
          strokeWidth="1"
          strokeDasharray="2 2"
          fill="none"
        />
        <path
          d="M 100 14 H 170 V 26"
          stroke="#52525b"
          strokeWidth="1"
          strokeDasharray="2 2"
          fill="none"
        />
      </svg>
      <div className="flex items-start gap-3">
        {["Sales", "Support", "Ops"].map((label) => (
          <div
            key={label}
            className="flex h-7 w-14 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800/60 text-[10px] font-medium text-zinc-300"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="mt-2 text-center">
        <p className="text-sm font-semibold text-zinc-200">{t("compare.teamTitle")}</p>
        <p className="mt-1 text-xs text-zinc-500">{t("compare.teamSub")}</p>
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
          className="grid gap-3 md:grid-cols-2"
        >
          <SingleAgentMockup />
          <TeamMockup />
        </motion.div>

        {/* 3 pain points */}
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PROBLEMS.map(({ key, Icon }, i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6"
            >
              <div className="flex items-center gap-2.5">
                <Icon size={15} className="text-violet-400" />
                <h3 className="font-display text-base font-semibold text-zinc-100">
                  {t(`points.${key}.title`)}
                </h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-500">
                {t(`points.${key}.desc`)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
