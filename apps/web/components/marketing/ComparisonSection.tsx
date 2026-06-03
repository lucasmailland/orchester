"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Check, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Cell = "yes" | "partial" | "no";

const COMPETITORS = ["orchester", "crewai", "autogen", "langgraph"] as const;
type Competitor = (typeof COMPETITORS)[number];

const ROWS: { feature: string; cells: Record<Competitor, Cell> }[] = [
  {
    feature: "multitenant",
    cells: { orchester: "yes", crewai: "no", autogen: "no", langgraph: "no" },
  },
  {
    feature: "visualFlow",
    cells: {
      orchester: "yes",
      crewai: "no",
      autogen: "no",
      langgraph: "partial",
    },
  },
  {
    feature: "memory",
    cells: {
      orchester: "yes",
      crewai: "partial",
      autogen: "partial",
      langgraph: "partial",
    },
  },
  {
    feature: "channels",
    cells: { orchester: "yes", crewai: "no", autogen: "no", langgraph: "no" },
  },
  {
    feature: "budgets",
    cells: { orchester: "yes", crewai: "no", autogen: "no", langgraph: "no" },
  },
  {
    feature: "audit",
    cells: {
      orchester: "yes",
      crewai: "no",
      autogen: "no",
      langgraph: "partial",
    },
  },
  {
    feature: "selfhost",
    cells: {
      orchester: "yes",
      crewai: "yes",
      autogen: "yes",
      langgraph: "yes",
    },
  },
  {
    feature: "license",
    cells: {
      orchester: "yes",
      crewai: "yes",
      autogen: "yes",
      langgraph: "yes",
    },
  },
];

function CellIcon({ value }: { value: Cell }) {
  if (value === "yes") return <Check size={16} className="text-emerald-400" />;
  if (value === "partial") return <Minus size={16} className="text-zinc-500" />;
  return <X size={16} className="text-zinc-700" />;
}

export function ComparisonSection() {
  const t = useTranslations("marketing.comparison");

  return (
    <section className="border-y border-zinc-800/40 bg-zinc-950/30 py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          className="mb-14 text-center"
        >
          <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            {t("eyebrow")}
          </p>
          <h2 className="font-display text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-400">
            {t("subtitle")}
          </p>
        </motion.div>

        {/* Desktop table */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          className="hidden md:block"
        >
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/30">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="px-5 py-4 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                    {t("featureCol")}
                  </th>
                  {COMPETITORS.map((c) => (
                    <th
                      key={c}
                      className={cn(
                        "px-5 py-4 text-center text-sm font-semibold",
                        c === "orchester"
                          ? "border-x border-violet-500/30 bg-violet-500/5 text-violet-200"
                          : "text-zinc-400"
                      )}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span>{t(`vendors.${c}`)}</span>
                        {c === "orchester" && (
                          <span className="rounded-full border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-violet-300">
                            {t("recommended")}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row, i) => (
                  <tr key={row.feature} className={i % 2 === 1 ? "bg-zinc-900/20" : ""}>
                    <td className="px-5 py-3.5 text-sm text-zinc-300">
                      {t(`rows.${row.feature}`)}
                    </td>
                    {COMPETITORS.map((c) => (
                      <td
                        key={c}
                        className={cn(
                          "px-5 py-3.5 text-center",
                          c === "orchester" && "border-x border-violet-500/30 bg-violet-500/5"
                        )}
                      >
                        <div className="flex items-center justify-center">
                          <CellIcon value={row.cells[c]} />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Mobile cards */}
        <div className="space-y-4 md:hidden">
          {COMPETITORS.map((c) => (
            <div
              key={c}
              className={cn(
                "rounded-2xl border p-5",
                c === "orchester"
                  ? "border-violet-500/30 bg-violet-500/5"
                  : "border-zinc-800 bg-zinc-900/40"
              )}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="font-display text-base font-semibold text-zinc-100">
                  {t(`vendors.${c}`)}
                </span>
                {c === "orchester" && (
                  <span className="rounded-full border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-300">
                    {t("recommended")}
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {ROWS.map((row) => (
                  <li key={row.feature} className="flex items-center gap-2">
                    <CellIcon value={row.cells[c]} />
                    <span className="text-sm text-zinc-400">{t(`rows.${row.feature}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footnote */}
        <p className="mt-8 text-center text-xs text-zinc-500">{t("footnote")}</p>
      </div>
    </section>
  );
}
