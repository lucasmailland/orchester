"use client";

import { useRef, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { motion, useInView } from "framer-motion";
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

function TypewriterCode({ source }: { source: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!inView) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setTyped(source.slice(0, i));
      if (i >= source.length) clearInterval(interval);
    }, 14);
    return () => clearInterval(interval);
  }, [inView, source]);

  const done = typed.length >= source.length;

  return (
    <pre
      ref={ref}
      className="overflow-x-auto p-5 font-mono text-xs leading-6 text-zinc-400 min-h-[180px]"
    >
      <code>
        {typed}
        <span
          className={cn(
            "inline-block w-[7px] h-[14px] -mb-[2px] ml-0.5 bg-violet-400/80",
            !done && "animate-pulse",
            done && "opacity-0"
          )}
        />
      </code>
    </pre>
  );
}

export function HowItWorks() {
  const t = useTranslations("marketing.howItWorks");

  return (
    <section className="py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          className="mb-16 text-center font-display text-3xl font-bold leading-[1.1] text-white sm:text-4xl"
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
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
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
                  <p className="text-base leading-relaxed text-zinc-400">{desc}</p>
                  <span className="block font-display text-6xl font-bold text-zinc-800/60">
                    {number}
                  </span>
                </div>

                {/* Code side */}
                <div className="flex-1">
                  <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-[#0A0A0C] shadow-2xl shadow-black/30">
                    <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
                      <div className="flex gap-1.5">
                        <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                        <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                        <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                      </div>
                      <div className="ml-2 h-4 flex-1 rounded-sm bg-zinc-800/50" />
                    </div>
                    <TypewriterCode source={CODE[key] ?? ""} />
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
