"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";

// ─── Provider data ────────────────────────────────────────────────────────────

type Provider = {
  abbr: string;
  name: string;
  text: string;
  bg: string;
  border: string;
};

const ROW_A: Provider[] = [
  {
    abbr: "ANT",
    name: "Anthropic",
    text: "text-orange-400",
    bg: "bg-orange-500/8",
    border: "border-orange-500/20",
  },
  {
    abbr: "OAI",
    name: "OpenAI",
    text: "text-emerald-400",
    bg: "bg-emerald-500/8",
    border: "border-emerald-500/20",
  },
  {
    abbr: "GEM",
    name: "Google Gemini",
    text: "text-blue-400",
    bg: "bg-blue-500/8",
    border: "border-blue-500/20",
  },
  {
    abbr: "MIS",
    name: "Mistral",
    text: "text-violet-400",
    bg: "bg-violet-500/8",
    border: "border-violet-500/20",
  },
  {
    abbr: "LLA",
    name: "Meta Llama",
    text: "text-amber-400",
    bg: "bg-amber-500/8",
    border: "border-amber-500/20",
  },
  {
    abbr: "COH",
    name: "Cohere",
    text: "text-pink-400",
    bg: "bg-pink-500/8",
    border: "border-pink-500/20",
  },
  {
    abbr: "PPX",
    name: "Perplexity",
    text: "text-cyan-400",
    bg: "bg-cyan-500/8",
    border: "border-cyan-500/20",
  },
  {
    abbr: "DSK",
    name: "DeepSeek",
    text: "text-indigo-400",
    bg: "bg-indigo-500/8",
    border: "border-indigo-500/20",
  },
  {
    abbr: "XAI",
    name: "xAI Grok",
    text: "text-zinc-300",
    bg: "bg-zinc-800/40",
    border: "border-zinc-700/50",
  },
  {
    abbr: "TGT",
    name: "Together",
    text: "text-rose-400",
    bg: "bg-rose-500/8",
    border: "border-rose-500/20",
  },
  {
    abbr: "GRQ",
    name: "Groq",
    text: "text-red-400",
    bg: "bg-red-500/8",
    border: "border-red-500/20",
  },
  {
    abbr: "REP",
    name: "Replicate",
    text: "text-fuchsia-400",
    bg: "bg-fuchsia-500/8",
    border: "border-fuchsia-500/20",
  },
];

const ROW_B: Provider[] = [
  {
    abbr: "AZR",
    name: "Azure OpenAI",
    text: "text-sky-400",
    bg: "bg-sky-500/8",
    border: "border-sky-500/20",
  },
  {
    abbr: "AWS",
    name: "Bedrock",
    text: "text-yellow-400",
    bg: "bg-yellow-500/8",
    border: "border-yellow-500/20",
  },
  {
    abbr: "VRT",
    name: "Vertex AI",
    text: "text-blue-400",
    bg: "bg-blue-500/8",
    border: "border-blue-500/20",
  },
  {
    abbr: "MS",
    name: "MistralAI",
    text: "text-violet-400",
    bg: "bg-violet-500/8",
    border: "border-violet-500/20",
  },
  {
    abbr: "FRW",
    name: "Fireworks",
    text: "text-orange-400",
    bg: "bg-orange-500/8",
    border: "border-orange-500/20",
  },
  {
    abbr: "OLM",
    name: "Ollama (local)",
    text: "text-emerald-400",
    bg: "bg-emerald-500/8",
    border: "border-emerald-500/20",
  },
  {
    abbr: "AI21",
    name: "AI21 Labs",
    text: "text-rose-400",
    bg: "bg-rose-500/8",
    border: "border-rose-500/20",
  },
  {
    abbr: "OR",
    name: "OpenRouter",
    text: "text-cyan-400",
    bg: "bg-cyan-500/8",
    border: "border-cyan-500/20",
  },
  {
    abbr: "VLM",
    name: "vLLM",
    text: "text-purple-400",
    bg: "bg-purple-500/8",
    border: "border-purple-500/20",
  },
  {
    abbr: "DBX",
    name: "Databricks",
    text: "text-red-400",
    bg: "bg-red-500/8",
    border: "border-red-500/20",
  },
  {
    abbr: "SBT",
    name: "Substrate",
    text: "text-amber-400",
    bg: "bg-amber-500/8",
    border: "border-amber-500/20",
  },
];

// ─── MarqueeRow ───────────────────────────────────────────────────────────────

function MarqueeRow({
  items,
  direction = "left",
  duration = 40,
}: {
  items: Provider[];
  direction?: "left" | "right";
  duration?: number;
}) {
  const xFrom = direction === "left" ? "0%" : "-50%";
  const xTo = direction === "left" ? "-50%" : "0%";

  return (
    <div className="overflow-hidden">
      <motion.div
        animate={{ x: [xFrom, xTo] }}
        transition={{ duration, repeat: Infinity, ease: "linear" }}
        className="flex w-max gap-3"
      >
        {[...items, ...items].map((p, i) => (
          <div
            key={`${p.abbr}-${i}`}
            className={`flex shrink-0 items-center gap-2.5 rounded-xl border px-4 py-2.5 ${p.bg} ${p.border}`}
          >
            <span className={`font-mono text-xs font-bold ${p.text}`}>{p.abbr}</span>
            <span className="whitespace-nowrap text-sm text-zinc-300">{p.name}</span>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

// ─── ModelMarquee ─────────────────────────────────────────────────────────────

export function ModelMarquee() {
  const t = useTranslations("marketing.modelMarquee");

  return (
    <section className="border-y border-zinc-800/40 bg-zinc-900/20 py-10">
      <p className="mb-6 text-center text-xs uppercase tracking-[0.2em] text-zinc-500">
        {t("title")}
      </p>

      <div
        className="relative space-y-3"
        style={{
          WebkitMaskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
          maskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
        }}
      >
        <MarqueeRow items={ROW_A} direction="left" duration={45} />
        <MarqueeRow items={ROW_B} direction="right" duration={50} />
      </div>
    </section>
  );
}
