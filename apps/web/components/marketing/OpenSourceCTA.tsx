"use client";

import { useTranslations, useLocale } from "next-intl";
import { motion } from "framer-motion";
import { Star, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

const GithubSVG = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

export function OpenSourceCTA() {
  const t = useTranslations("marketing.cta");
  const locale = useLocale();

  return (
    <section className="relative overflow-hidden py-24">
      <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-10 backdrop-blur-sm sm:p-14"
        >
          <h2 className="mb-4 font-display text-4xl font-bold leading-[1.1] text-white sm:text-5xl">
            {t("title")}
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-base leading-relaxed text-zinc-400">
            {t("subtitle")}
          </p>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            {/* GitHub star CTA */}
            <a
              href="https://github.com/lucasmailland/orchester"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "group flex items-center gap-2 rounded-xl px-7 py-3.5 text-sm font-semibold text-white",
                "bg-violet-600 transition-all duration-200",
                "shadow-2xl shadow-black/30",
                "hover:bg-violet-500 hover:scale-[1.02]"
              )}
            >
              <GithubSVG />
              <Star size={13} className="text-amber-300" />
              {t("primaryButton")}
            </a>

            {/* Self-host docs */}
            <Link
              href={`/${locale}/docs`}
              className={cn(
                "flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-7 py-3.5 text-sm font-medium text-zinc-300",
                "transition-all hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"
              )}
            >
              <Terminal size={14} />
              {t("secondaryButton")}
            </Link>
          </div>

          {/* Terminal command */}
          <div className="mt-8 inline-flex items-center gap-3 rounded-xl border border-zinc-800 bg-[#0A0A0C] px-5 py-3">
            <span className="font-mono text-xs text-violet-400">$</span>
            <code className="font-mono text-xs tracking-wide text-zinc-400">
              {t("selfHostCommand")}
            </code>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
