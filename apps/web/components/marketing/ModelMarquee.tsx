"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";

// ─── Provider data ────────────────────────────────────────────────────────────

type Provider = {
  abbr: string;
  name: string;
};

const ROW_A: Provider[] = [
  { abbr: "ANT", name: "Anthropic" },
  { abbr: "OAI", name: "OpenAI" },
  { abbr: "GEM", name: "Google Gemini" },
  { abbr: "MIS", name: "Mistral" },
  { abbr: "LLA", name: "Meta Llama" },
  { abbr: "COH", name: "Cohere" },
  { abbr: "PPX", name: "Perplexity" },
  { abbr: "DSK", name: "DeepSeek" },
  { abbr: "XAI", name: "xAI Grok" },
  { abbr: "TGT", name: "Together" },
  { abbr: "GRQ", name: "Groq" },
  { abbr: "REP", name: "Replicate" },
];

const ROW_B: Provider[] = [
  { abbr: "AZR", name: "Azure OpenAI" },
  { abbr: "AWS", name: "Bedrock" },
  { abbr: "VRT", name: "Vertex AI" },
  { abbr: "MS", name: "MistralAI" },
  { abbr: "FRW", name: "Fireworks" },
  { abbr: "OLM", name: "Ollama (local)" },
  { abbr: "AI21", name: "AI21 Labs" },
  { abbr: "OR", name: "OpenRouter" },
  { abbr: "VLM", name: "vLLM" },
  { abbr: "DBX", name: "Databricks" },
  { abbr: "SBT", name: "Substrate" },
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
            className="flex shrink-0 items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-2.5"
          >
            <span className="font-mono text-xs font-bold text-violet-400">{p.abbr}</span>
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
    <section className="border-y border-zinc-800/40 bg-zinc-900/20 py-16">
      <p className="mb-6 text-center text-[11px] uppercase tracking-[0.2em] text-zinc-500">
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
