"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const QUESTIONS = ["free", "selfhost", "models", "multitenant", "production", "cloud"] as const;
type QKey = (typeof QUESTIONS)[number];

export function FaqSection() {
  const t = useTranslations("marketing.faq");
  const [open, setOpen] = useState<QKey | null>(QUESTIONS[0]!);

  return (
    <section className="relative py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-12 text-center"
        >
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-zinc-500">{t("eyebrow")}</p>
          <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t("title")}
          </h2>
        </motion.div>

        <div className="space-y-2">
          {QUESTIONS.map((key, i) => {
            const isOpen = open === key;
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
                className={cn(
                  "overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/30 transition-colors",
                  isOpen ? "bg-zinc-900/60" : "hover:bg-zinc-900/50"
                )}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : key)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="font-display text-base font-medium text-zinc-100">
                    {t(`q.${key}.question`)}
                  </span>
                  <motion.span
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-700/60 text-zinc-400"
                  >
                    <Plus size={13} />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 text-sm leading-relaxed text-zinc-400">
                        {t(`q.${key}.answer`)}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
