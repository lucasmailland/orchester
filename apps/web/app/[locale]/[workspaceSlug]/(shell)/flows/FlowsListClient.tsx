"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "framer-motion";
import { Workflow, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { NoProviderBanner } from "@/components/common/NoProviderBanner";

interface Item {
  id: string;
  name: string;
  description: string | null;
  status: string;
  nodeCount: number;
  lastRunAt: string | null;
}

export function FlowsListClient({ flows }: { flows: Item[] }) {
  const router = useRouter();
  const t = useTranslations("pages.flows");
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "es";
  const workspaceSlug = params?.workspaceSlug ?? "";
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  async function create() {
    if (!name.trim()) return;
    const r = await fetch("/api/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      const j = await r.json();
      router.push(`/${locale}/${workspaceSlug}/flows/${j.id}`);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <NoProviderBanner />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-strong">{t("title")}</h1>
          <p className="text-sm text-muted">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-400"
        >
          <Plus className="h-4 w-4" /> {t("newFlow")}
        </button>
      </div>

      {creating && (
        <div className="rounded-2xl border border-violet-500/30 bg-card p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={create}
              className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs text-white hover:bg-violet-400"
            >
              {t("create")}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="text-xs text-muted hover:text-body"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {flows.length === 0 && !creating && (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center">
          <Workflow className="mx-auto mb-3 h-8 w-8 text-faint" />
          <h3 className="text-sm font-medium text-body">{t("emptyTitle")}</h3>
          <p className="mt-1 text-xs text-muted">{t("emptyDescription")}</p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {flows.map((f) => (
          <motion.button
            key={f.id}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => router.push(`/${locale}/flows/${f.id}`)}
            className="rounded-2xl border border-line bg-card p-4 text-left hover:border-violet-500/40"
          >
            <div className="mb-2 flex items-center gap-2">
              <Workflow className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              <span className="font-medium text-strong">{f.name}</span>
            </div>
            <p className="line-clamp-2 text-xs text-muted">{f.description ?? "—"}</p>
            <div className="mt-3 flex items-center justify-between text-[10px] text-faint">
              <span>
                {f.nodeCount} {t("nodes")}
              </span>
              <span>{f.status}</span>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
