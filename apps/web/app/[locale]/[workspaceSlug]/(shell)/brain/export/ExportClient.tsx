"use client";

import { useState } from "react";
import { Download, FileJson, FileText, ShieldCheck, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

type ExportFormat = "json" | "csv";
type ExportScope = "all" | "kind" | "scope";

const KIND_OPTIONS = ["preference", "trait", "event", "relationship", "skill", "concern", "other"];
const SCOPE_OPTIONS = ["global", "conversation", "employee", "team"];

export function ExportClient() {
  const t = useTranslations("brain.export");
  const [format, setFormat] = useState<ExportFormat>("json");
  const [scopeMode, setScopeMode] = useState<ExportScope>("all");
  const [kindFilter, setKindFilter] = useState<string>(KIND_OPTIONS[0]!);
  const [scopeFilter, setScopeFilter] = useState<string>(SCOPE_OPTIONS[0]!);
  const [downloading, setDownloading] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    const params = new URLSearchParams({ format });
    if (scopeMode === "kind") params.set("kind", kindFilter);
    if (scopeMode === "scope") params.set("scope", scopeFilter);
    const url = `/api/mnemo/export?${params.toString()}`;
    try {
      const res = await fetch(url, { headers: { accept: "application/octet-stream" } });
      if (!res.ok) {
        if (res.status === 404) {
          notify.error(t("notReady"));
        } else {
          notify.error(t("error"));
        }
        return;
      }
      const blob = await res.blob();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `mnemosyne-export-${stamp}.${format}`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer revoke so Safari can flush the download.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      notify.success(t("success"));
    } catch {
      notify.error(t("error"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-fichap-primary" aria-hidden />
          <h1 className="text-xl font-bold text-strong">{t("title")}</h1>
        </div>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </header>

      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          {t("format")}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setFormat("json")}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4 text-left transition",
              format === "json"
                ? "border-fichap-primary bg-fichap-primary/5"
                : "border-line bg-elevated hover:border-line/60"
            )}
            aria-pressed={format === "json"}
          >
            <FileJson className="h-5 w-5 shrink-0 text-fichap-primary" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-strong">{t("jsonTitle")}</p>
              <p className="mt-1 text-xs text-muted">{t("jsonDescription")}</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setFormat("csv")}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4 text-left transition",
              format === "csv"
                ? "border-fichap-primary bg-fichap-primary/5"
                : "border-line bg-elevated hover:border-line/60"
            )}
            aria-pressed={format === "csv"}
          >
            <FileText className="h-5 w-5 shrink-0 text-fichap-primary" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-strong">{t("csvTitle")}</p>
              <p className="mt-1 text-xs text-muted">{t("csvDescription")}</p>
            </div>
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          {t("scope")}
        </h2>
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm text-body">
            <input
              type="radio"
              name="scope-mode"
              checked={scopeMode === "all"}
              onChange={() => setScopeMode("all")}
              className="h-3.5 w-3.5"
            />
            <span>{t("scopeAll")}</span>
          </label>
          <label className="flex items-center gap-3 text-sm text-body">
            <input
              type="radio"
              name="scope-mode"
              checked={scopeMode === "kind"}
              onChange={() => setScopeMode("kind")}
              className="h-3.5 w-3.5"
            />
            <span>{t("scopeByKind")}</span>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              disabled={scopeMode !== "kind"}
              className="ml-auto rounded-lg border border-line bg-elevated px-2 py-1 text-xs text-strong disabled:opacity-40"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-3 text-sm text-body">
            <input
              type="radio"
              name="scope-mode"
              checked={scopeMode === "scope"}
              onChange={() => setScopeMode("scope")}
              className="h-3.5 w-3.5"
            />
            <span>{t("scopeByScope")}</span>
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              disabled={scopeMode !== "scope"}
              className="ml-auto rounded-lg border border-line bg-elevated px-2 py-1 text-xs text-strong disabled:opacity-40"
            >
              {SCOPE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <Button
        color="primary"
        size="lg"
        className="w-full"
        onPress={handleDownload}
        isLoading={downloading}
        startContent={!downloading ? <Download className="h-4 w-4" /> : null}
      >
        {t("download")}
      </Button>

      <section className="rounded-2xl border border-line bg-card">
        <button
          type="button"
          onClick={() => setSchemaOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 px-5 py-3 text-left hover:bg-hover"
          aria-expanded={schemaOpen}
        >
          <span className="text-sm font-semibold text-strong">{t("whatsInside")}</span>
          {schemaOpen ? (
            <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
          )}
        </button>
        {schemaOpen ? (
          <div className="space-y-3 border-t border-line px-5 py-4 text-xs text-body">
            <div>
              <p className="font-semibold text-strong">facts[]</p>
              <p className="mt-0.5 text-muted">{t("schema.facts")}</p>
            </div>
            <div>
              <p className="font-semibold text-strong">decisions[]</p>
              <p className="mt-0.5 text-muted">{t("schema.decisions")}</p>
            </div>
            <div>
              <p className="font-semibold text-strong">relations[]</p>
              <p className="mt-0.5 text-muted">{t("schema.relations")}</p>
            </div>
            <div>
              <p className="font-semibold text-strong">citations[]</p>
              <p className="mt-0.5 text-muted">{t("schema.citations")}</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
        <div className="text-xs text-emerald-100/90">
          <p className="font-semibold text-emerald-200">{t("privacyTitle")}</p>
          <p className="mt-1 text-emerald-100/70">{t("privacyBody")}</p>
        </div>
      </section>
    </div>
  );
}
