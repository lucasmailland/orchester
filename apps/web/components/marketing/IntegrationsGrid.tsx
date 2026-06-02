"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";

const PROVIDERS = [
  {
    name: "Anthropic",
    abbr: "ANT",
    color: "text-orange-400",
    bg: "bg-orange-500/8  border-orange-500/20",
  },
  {
    name: "OpenAI",
    abbr: "OAI",
    color: "text-emerald-400",
    bg: "bg-emerald-500/8 border-emerald-500/20",
  },
  {
    name: "Gemini",
    abbr: "GEM",
    color: "text-blue-400",
    bg: "bg-blue-500/8    border-blue-500/20",
  },
  {
    name: "Mistral",
    abbr: "MIS",
    color: "text-violet-400",
    bg: "bg-violet-500/8  border-violet-500/20",
  },
  {
    name: "Meta Llama",
    abbr: "LLA",
    color: "text-amber-400",
    bg: "bg-amber-500/8   border-amber-500/20",
  },
  {
    name: "Cohere",
    abbr: "COH",
    color: "text-pink-400",
    bg: "bg-pink-500/8    border-pink-500/20",
  },
  {
    name: "Perplexity",
    abbr: "PPX",
    color: "text-cyan-400",
    bg: "bg-cyan-500/8    border-cyan-500/20",
  },
  {
    name: "DeepSeek",
    abbr: "DSK",
    color: "text-indigo-400",
    bg: "bg-indigo-500/8  border-indigo-500/20",
  },
  {
    name: "Grok (xAI)",
    abbr: "GRK",
    color: "text-zinc-300",
    bg: "bg-zinc-800/40   border-zinc-700/50",
  },
  {
    name: "+ 71 more",
    abbr: "···",
    color: "text-zinc-600",
    bg: "bg-zinc-900/60   border-zinc-800",
  },
];

export function IntegrationsGrid() {
  const t = useTranslations("marketing.integrations");

  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
        >
          {t("title")}
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="mb-12 text-base text-zinc-500"
        >
          {t("subtitle")}
        </motion.p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {PROVIDERS.map(({ name, abbr, color, bg }, i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, scale: 0.88 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              className={`flex items-center gap-2.5 rounded-xl border px-4 py-2.5 ${bg} transition-all duration-200 hover:border-zinc-600`}
            >
              <span className={`font-mono text-xs font-bold ${color}`}>{abbr}</span>
              <span className="text-sm text-zinc-400">{name}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
