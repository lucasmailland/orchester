"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Quote } from "lucide-react";

const QUOTES = [{ key: "ana" }, { key: "marcus" }, { key: "rafael" }] as const;

export function TestimonialsSection() {
  const t = useTranslations("marketing.testimonials");
  return (
    <section className="relative py-24">
      <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          className="mb-12 text-center"
        >
          <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            {t("eyebrow")}
          </p>
          <h2 className="font-display text-3xl font-bold leading-[1.1] text-white sm:text-4xl">
            {t("title")}
          </h2>
        </motion.div>

        <div className="grid gap-5 md:grid-cols-3">
          {QUOTES.map(({ key }, i) => (
            <motion.figure
              key={key}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.08, duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
              className="group relative flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-zinc-700 hover:bg-zinc-900/60"
            >
              <Quote size={18} className="mb-4 text-violet-400/60" />
              <blockquote className="flex-1 text-base leading-relaxed text-zinc-400">
                {t(`quotes.${key}.body`)}
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-violet-500/30 bg-violet-500/15 font-display text-sm font-bold text-violet-300">
                  {(t(`quotes.${key}.name`) as string)[0]}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-100">
                    {t(`quotes.${key}.name`)}
                  </div>
                  <div className="text-xs text-zinc-500">{t(`quotes.${key}.role`)}</div>
                </div>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
}
