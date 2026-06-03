"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import {
  MessagesSquare,
  Zap,
  Workflow,
  Wallet,
  KeyRound,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { type MouseEvent } from "react";
import { cn } from "@/lib/utils";

type FeatureKey = "multiChannel" | "streaming" | "flows" | "costControl" | "byok" | "enterprise";

const FEATURES: {
  key: FeatureKey;
  icon: LucideIcon;
  accent: string;
  hoverBg: string;
  iconBg: string;
  colSpan: "md:col-span-2" | "md:col-span-1";
}[] = [
  {
    key: "multiChannel",
    icon: MessagesSquare,
    accent: "text-violet-400",
    hoverBg: "from-violet-500/8",
    iconBg: "bg-violet-500/10 border-violet-500/20",
    colSpan: "md:col-span-2",
  },
  {
    key: "streaming",
    icon: Zap,
    accent: "text-cyan-400",
    hoverBg: "from-cyan-500/8",
    iconBg: "bg-cyan-500/10 border-cyan-500/20",
    colSpan: "md:col-span-1",
  },
  {
    key: "flows",
    icon: Workflow,
    accent: "text-indigo-400",
    hoverBg: "from-indigo-500/8",
    iconBg: "bg-indigo-500/10 border-indigo-500/20",
    colSpan: "md:col-span-1",
  },
  {
    key: "costControl",
    icon: Wallet,
    accent: "text-emerald-400",
    hoverBg: "from-emerald-500/8",
    iconBg: "bg-emerald-500/10 border-emerald-500/20",
    colSpan: "md:col-span-2",
  },
  {
    key: "byok",
    icon: KeyRound,
    accent: "text-amber-400",
    hoverBg: "from-amber-500/8",
    iconBg: "bg-amber-500/10 border-amber-500/20",
    colSpan: "md:col-span-1",
  },
  {
    key: "enterprise",
    icon: Shield,
    accent: "text-rose-400",
    hoverBg: "from-rose-500/8",
    iconBg: "bg-rose-500/10 border-rose-500/20",
    colSpan: "md:col-span-1",
  },
];

export function FeaturesGrid() {
  const t = useTranslations("marketing.features");

  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t("title")} <span className="text-zinc-500">{t("subtitle")}</span>
          </h2>
        </motion.div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {FEATURES.map(({ key, icon: Icon, accent, hoverBg, iconBg, colSpan }, i) => {
            const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
              const rect = e.currentTarget.getBoundingClientRect();
              e.currentTarget.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
              e.currentTarget.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
            };

            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: i * 0.07, duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
                onMouseMove={handleMouseMove}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6",
                  "transition-all duration-300 hover:border-zinc-700 hover:bg-zinc-900/60",
                  colSpan
                )}
              >
                {/* Spotlight layer — follows cursor */}
                <div
                  className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    background:
                      "radial-gradient(400px circle at var(--mouse-x) var(--mouse-y), rgba(167, 139, 250, 0.10), transparent 60%)",
                  }}
                />

                {/* Hover gradient */}
                <div
                  className={cn(
                    "absolute inset-0 bg-gradient-to-br to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100",
                    hoverBg
                  )}
                />

                <div className="relative z-10">
                  <div
                    className={cn(
                      "mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border",
                      iconBg,
                      accent
                    )}
                  >
                    <Icon size={18} />
                  </div>
                  <h3 className="mb-2 font-display text-base font-semibold text-zinc-100">
                    {(t as (k: string) => string)(`${key}.title`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-zinc-500">
                    {(t as (k: string) => string)(`${key}.desc`)}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
