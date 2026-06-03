"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Brain, TrendingDown, Eye, Shield, Search, type LucideIcon } from "lucide-react";

const FEATURES: { Icon: LucideIcon; key: string; accent: string }[] = [
  { Icon: Brain, key: "semantic", accent: "text-violet-400 bg-violet-500/10 border-violet-500/30" },
  {
    Icon: TrendingDown,
    key: "decay",
    accent: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  },
  { Icon: Eye, key: "inspect", accent: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30" },
  { Icon: Shield, key: "gdpr", accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
];

const FACTS = [
  {
    text: "User prefers concise, technical responses",
    strength: 94,
    source: "msg #1247",
    tags: ["semantic", "high-confidence"],
  },
  {
    text: "Account tier: Enterprise · 50 seats",
    strength: 88,
    source: "msg #844",
    tags: ["semantic", "high-confidence"],
  },
  {
    text: "Onboarded 2024-03 via Slack channel",
    strength: 71,
    source: "msg #312",
    tags: ["episode"],
  },
  {
    text: "Previously contacted by Sales (Q3)",
    strength: 54,
    source: "msg #198",
    tags: ["episode", "decaying"],
  },
  {
    text: "Mentioned competitor X during demo",
    strength: 38,
    source: "msg #92",
    tags: ["decaying"],
  },
];

function FactRow({
  index,
  text,
  strength,
  source,
  tags,
}: {
  index: number;
  text: string;
  strength: number;
  source: string;
  tags: string[];
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-[10px] font-bold text-violet-300">
        {index}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] text-zinc-200">{text}</p>
        <p className="mt-0.5 text-[10px] text-zinc-500">decay: -2%/d · {source}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
              style={{ width: `${strength}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] text-zinc-500">{strength}%</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tags.map((tg) => (
            <span
              key={tg}
              className="rounded border border-zinc-700/60 bg-zinc-800/40 px-1.5 py-0.5 text-[9px] text-zinc-500"
            >
              {tg}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function BrainInspectorMockup() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 shadow-2xl shadow-black/40 backdrop-blur-sm">
      {/* Window chrome */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/50" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-500/50" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/50" />
        </div>
        <div className="ml-2 flex h-5 flex-1 items-center rounded-md bg-zinc-800/60 px-2">
          <span className="text-[10px] text-zinc-500">orchester.app / brain / inspector</span>
        </div>
      </div>

      {/* Search bar */}
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
        <Search size={12} className="text-zinc-600" />
        <span className="text-[11px] text-zinc-600">Search 1,247 facts...</span>
        <span className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono text-[9px] text-zinc-500">
          ⌘K
        </span>
      </div>

      {/* Stats bar */}
      <div className="mb-3 flex items-center gap-3 text-[10px] text-zinc-500">
        <span>
          <span className="font-mono text-zinc-300">1,247</span> total
        </span>
        <span className="text-zinc-700">·</span>
        <span>
          <span className="font-mono text-emerald-400">312</span> high-conf
        </span>
        <span className="text-zinc-700">·</span>
        <span>
          <span className="font-mono text-amber-400">89</span> decaying
        </span>
      </div>

      {/* Facts list */}
      <div className="space-y-1.5">
        {FACTS.map((f, i) => (
          <FactRow
            key={i}
            index={i + 1}
            text={f.text}
            strength={f.strength}
            source={f.source}
            tags={f.tags}
          />
        ))}
      </div>

      {/* Fade out bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-b-2xl bg-gradient-to-t from-[#09090B] to-transparent" />
    </div>
  );
}

export function BrainSection() {
  const t = useTranslations("marketing.brain");

  return (
    <section className="relative overflow-hidden py-28">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute left-1/4 top-1/2 h-[500px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/4 blur-[140px]" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Left — text */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-violet-400">
              {t("eyebrow")}
            </p>
            <h2 className="font-display text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-5xl">
              {t("title1")}
              <br />
              <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                {t("title2")}
              </span>
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-zinc-400">{t("subtitle")}</p>

            <ul className="mt-8 space-y-4">
              {FEATURES.map(({ Icon, key, accent }, i) => (
                <motion.li
                  key={key}
                  initial={{ opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 + i * 0.07, duration: 0.4 }}
                  className="flex items-start gap-4"
                >
                  <div
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${accent}`}
                  >
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-sm font-semibold text-zinc-100">
                      {t(`feats.${key}.title`)}
                    </h3>
                    <p className="mt-0.5 text-sm leading-relaxed text-zinc-500">
                      {t(`feats.${key}.desc`)}
                    </p>
                  </div>
                </motion.li>
              ))}
            </ul>
          </motion.div>

          {/* Right — mockup */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <BrainInspectorMockup />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
