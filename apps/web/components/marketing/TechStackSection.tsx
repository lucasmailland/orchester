"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Check, Database, Workflow, Webhook, Activity, Lock } from "lucide-react";

const PROOFS = [
  { key: "pgvector", Icon: Database },
  { key: "workers", Icon: Workflow },
  { key: "webhooks", Icon: Webhook },
  { key: "otel", Icon: Activity },
  { key: "rls", Icon: Lock },
] as const;

export function TechStackSection() {
  const t = useTranslations("marketing.techStack");

  return (
    <section className="relative overflow-hidden border-y border-zinc-800/60 bg-zinc-950 py-24">
      {/* subtle grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            "linear-gradient(#a78bfa 1px, transparent 1px), linear-gradient(90deg, #a78bfa 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="pointer-events-none absolute -left-20 top-1/3 h-[400px] w-[400px] rounded-full bg-violet-500/4 blur-[100px]" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* Left: text + proofs */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {t("title1")} <span className="text-zinc-500">{t("title2")}</span>{" "}
              <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                {t("title3")}
              </span>
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-zinc-400">{t("subtitle")}</p>

            <ul className="mt-8 space-y-4">
              {PROOFS.map(({ key, Icon }, i) => (
                <motion.li
                  key={key}
                  initial={{ opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ delay: 0.1 + i * 0.07, duration: 0.4 }}
                  className="flex items-start gap-4"
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10 text-violet-400">
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-sm font-semibold text-zinc-100">
                        {t(`proofs.${key}.title`)}
                      </h3>
                      <Check size={12} className="text-emerald-400" />
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-500">
                      {t(`proofs.${key}.desc`)}
                    </p>
                  </div>
                </motion.li>
              ))}
            </ul>
          </motion.div>

          {/* Right: terminal */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 0.61, 0.36, 1] }}
            className="relative"
          >
            {/* glow */}
            <div className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-violet-500/20 to-cyan-500/10 opacity-50 blur-2xl" />

            <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-[#0A0A0C] shadow-2xl shadow-black/50 transition-colors hover:border-zinc-700">
              {/* mac chrome */}
              <div className="flex items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500/50" />
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500/50" />
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/50" />
                </div>
                <div className="ml-2 flex h-5 flex-1 items-center justify-center rounded-md bg-zinc-800/50 px-2">
                  <span className="text-[10px] text-zinc-600">~ / orchester / setup.sh</span>
                </div>
              </div>

              <pre className="overflow-x-auto p-6 font-mono text-[12px] leading-[1.7]">
                <code className="text-zinc-400">
                  <span className="text-emerald-400/80"># Self-host in 30 seconds</span>
                  {"\n"}
                  <span className="text-violet-400">$</span>{" "}
                  <span className="text-zinc-200">
                    git clone github.com/lucasmailland/orchester
                  </span>
                  {"\n"}
                  <span className="text-violet-400">$</span>{" "}
                  <span className="text-zinc-200">cp .env.example .env</span>
                  {"\n"}
                  <span className="text-violet-400">$</span>{" "}
                  <span className="text-zinc-200">docker compose up -d</span>
                  {"\n\n"}
                  <span className="text-emerald-400/80"># Or use our cloud — bring your key:</span>
                  {"\n"}
                  <span className="text-violet-400">$</span>{" "}
                  <span className="text-zinc-200">curl https://api.orchester.io/v1/agents</span>{" "}
                  {"\\"}
                  {"\n"}
                  {"    "}
                  <span className="text-cyan-400">-H</span>{" "}
                  <span className="text-amber-300">{`"Authorization: Bearer $ORCHESTER_KEY"`}</span>{" "}
                  {"\\"}
                  {"\n"}
                  {"    "}
                  <span className="text-cyan-400">-d</span>{" "}
                  <span className="text-amber-300">{"'{"}</span>
                  {"\n"}
                  {"      "}
                  <span className="text-amber-300">{`"name": "Support Bot",`}</span>
                  {"\n"}
                  {"      "}
                  <span className="text-amber-300">{`"model": "claude-sonnet-4-6",`}</span>
                  {"\n"}
                  {"      "}
                  <span className="text-amber-300">
                    {`"tools": ["web_search", "knowledge_base"]`}
                  </span>
                  {"\n"}
                  {"    "}
                  <span className="text-amber-300">{"}'}"}</span>
                </code>
              </pre>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
