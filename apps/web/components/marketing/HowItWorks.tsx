"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const CODE: Record<string, string> = {
  step1: `# Clone and configure
git clone https://github.com/lucasmailland/orchester
cp .env.example .env

# Start everything (Postgres + Redis included)
docker compose up -d
pnpm install && pnpm db:migrate && pnpm dev`,

  step2: `// Create your first agent via the UI or API
const agent = await orchester.agents.create({
  name: "Support Bot",
  model: "claude-sonnet-4-6",
  persona: "You are a helpful support agent...",
  memory: { strategy: "semantic", decay: true },
  tools: ["web_search", "file_reader"],
});`,

  step3: `// Chain agents into a visual flow
const flow = await orchester.flows.create({
  name: "Customer Onboarding",
  nodes: [triageAgent, supportAgent, analyticsAgent],
  edges: [
    { from: "triage",   to: "support",   condition: "needs_help" },
    { from: "triage",   to: "analytics", condition: "resolved"   },
  ],
});`,
};

const STEPS = [
  { key: "step1", number: "01" },
  { key: "step2", number: "02" },
  { key: "step3", number: "03" },
] as const;

export function HowItWorks() {
  const t = useTranslations("marketing.howItWorks");

  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-16 text-center font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
        >
          {t("title")}
        </motion.h2>

        <div className="space-y-16">
          {STEPS.map(({ key, number }, i) => {
            const isEven = i % 2 === 0;
            const label =
              key === "step1"
                ? t("step1.label")
                : key === "step2"
                  ? t("step2.label")
                  : t("step3.label");
            const title =
              key === "step1"
                ? t("step1.title")
                : key === "step2"
                  ? t("step2.title")
                  : t("step3.title");
            const desc =
              key === "step1"
                ? t("step1.desc")
                : key === "step2"
                  ? t("step2.desc")
                  : t("step3.desc");
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, x: isEven ? -24 : 24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.65, ease: [0.22, 0.61, 0.36, 1] }}
                className={cn(
                  "flex flex-col gap-8 md:flex-row md:items-center",
                  !isEven && "md:flex-row-reverse"
                )}
              >
                {/* Text side */}
                <div className="flex-1 space-y-4">
                  <span className="inline-block rounded-full border border-violet-500/20 bg-violet-500/5 px-3 py-1 text-xs font-medium text-violet-400">
                    {label}
                  </span>
                  <h3 className="font-display text-xl font-semibold text-zinc-100">{title}</h3>
                  <p className="text-sm leading-relaxed text-zinc-500">{desc}</p>
                  <span className="block font-display text-6xl font-bold text-zinc-800/60">
                    {number}
                  </span>
                </div>

                {/* Code side */}
                <div className="flex-1">
                  <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-[#0A0A0C] shadow-xl shadow-black/30">
                    <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
                      <div className="flex gap-1.5">
                        <div className="h-2.5 w-2.5 rounded-full bg-red-500/40" />
                        <div className="h-2.5 w-2.5 rounded-full bg-amber-500/40" />
                        <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/40" />
                      </div>
                      <div className="ml-2 h-4 flex-1 rounded-sm bg-zinc-800/50" />
                    </div>
                    <pre className="overflow-x-auto p-5 font-mono text-xs leading-6 text-zinc-400">
                      <code>{CODE[key]}</code>
                    </pre>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
