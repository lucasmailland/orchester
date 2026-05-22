"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, KeyRound, Eye, EyeOff, Check, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROVIDERS, MODELS, CAPABILITY_LABELS, type Capability, type ProviderDef } from "@/lib/ai/catalog";

interface ProviderRow {
  id: string;
  provider: string;
  apiKeyMasked: string;
  endpoint: string | null;
  enabled: boolean;
  models: Array<{ id: string; name: string; tier: string }>;
  lastTestStatus: string | null;
  lastTestError: string | null;
}

const CAPABILITY_ORDER: Capability[] = [
  "chat", "image", "embedding", "video", "avatar", "tts", "stt", "music", "rerank", "ocr",
];

// Cantidad de modelos en catálogo por proveedor (para mostrar aunque no se haya "probado").
const CATALOG_MODEL_COUNT: Record<string, number> = MODELS.reduce((acc, m) => {
  acc[m.provider] = (acc[m.provider] ?? 0) + 1;
  return acc;
}, {} as Record<string, number>);

export function AIProvidersSection() {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  // Cada proveedor se muestra una vez, bajo su capacidad PRIMARIA (la primera).
  const byPrimary = useMemo(() => {
    const groups: Record<string, ProviderDef[]> = {};
    for (const p of PROVIDERS) {
      const primary = p.capabilities[0]!;
      (groups[primary] ??= []).push(p);
    }
    return groups;
  }, []);

  if (loading)
    return (
      <div className="flex h-32 items-center justify-center text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  return (
    <div className="space-y-8">
      {CAPABILITY_ORDER.filter((c) => byPrimary[c]?.length).map((cap) => (
        <section key={cap}>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
            <span>{CAPABILITY_LABELS[cap].emoji}</span> {CAPABILITY_LABELS[cap].es}
          </h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {byPrimary[cap]!.map((p) => (
              <ProviderCard
                key={p.id}
                def={p}
                row={rows.find((r) => r.provider === p.id) ?? null}
                onChange={(updated) =>
                  setRows((prev) => {
                    const others = prev.filter((r) => r.provider !== p.id);
                    return updated ? [...others, updated] : others;
                  })
                }
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProviderCard({
  def,
  row,
  onChange,
}: {
  def: ProviderDef;
  row: ProviderRow | null;
  onChange: (r: ProviderRow | null) => void;
}) {
  const needsEndpoint = def.auth === "api_key+endpoint";
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState(row?.endpoint ?? "");
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function save() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setFeedback(null);
    const r = await fetch("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: def.id, apiKey, endpoint: endpoint || undefined }),
    });
    setSaving(false);
    if (!r.ok) {
      setFeedback("Error al guardar");
      return;
    }
    setApiKey("");
    setFeedback("Conectado");
    const all = await fetch("/api/providers").then((x) => x.json());
    onChange(all.find((x: ProviderRow) => x.provider === def.id) ?? null);
  }

  async function test() {
    if (!row) return;
    setTesting(true);
    setFeedback(null);
    const r = await fetch(`/api/providers/${row.id}/test`, { method: "POST" });
    const j = await r.json();
    setTesting(false);
    setFeedback(j.ok ? `OK · ${j.models?.length ?? 0} modelos` : `Error: ${j.error}`);
    const all = await fetch("/api/providers").then((x) => x.json());
    onChange(all.find((x: ProviderRow) => x.provider === def.id) ?? null);
  }

  async function remove() {
    if (!row) return;
    await fetch(`/api/providers/${row.id}`, { method: "DELETE" });
    onChange(null);
    setApiKey("");
    setFeedback(null);
    setOpen(false);
  }

  const connected = !!row;
  const dot = connected ? "bg-emerald-400" : "bg-zinc-600/60";
  const modelCount = row?.models?.length || CATALOG_MODEL_COUNT[def.id] || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("rounded-2xl border bg-card p-4", connected ? "border-emerald-500/30" : "border-line")}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-strong">{def.name}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
              {connected ? "Conectado" : "No conectado"}
              {def.kind === "aggregator" && <span className="text-faint">· agregador</span>}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg border border-line px-2 py-1 text-[11px] text-body hover:bg-hover"
        >
          {connected ? "Editar" : "Conectar"}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {def.capabilities.map((c) => (
          <span key={c} className="rounded-full bg-elevated px-1.5 py-0.5 text-[9px] text-muted">
            {CAPABILITY_LABELS[c].emoji} {CAPABILITY_LABELS[c].es}
          </span>
        ))}
      </div>
      {modelCount > 0 && <p className="mt-1.5 text-[10px] text-faint">{modelCount} modelos en el catálogo</p>}

      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {row && (
            <div className="flex items-center justify-between rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-[11px]">
              <span className="font-mono text-muted">{row.apiKeyMasked}</span>
              <button onClick={remove} type="button" className="text-muted hover:text-red-600 dark:hover:text-red-400">
                Quitar
              </button>
            </div>
          )}
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
            <input
              type={show ? "text" : "password"}
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={row ? "Reemplazar key…" : def.keyHint ? `API key · ${def.keyHint}` : "API key"}
              className="w-full rounded-lg border border-line bg-elevated py-2 pl-8 pr-8 text-xs text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
            />
            <button onClick={() => setShow((s) => !s)} type="button" aria-label="Mostrar/ocultar" className="absolute right-2.5 top-2.5 text-muted hover:text-body">
              {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          {needsEndpoint && (
            <input
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://… (endpoint)"
              className="w-full rounded-lg border border-line bg-elevated px-2.5 py-2 text-xs text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
            />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={!apiKey.trim() || saving}
              className="flex-1 rounded-lg bg-violet-500/90 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
            {row && (
              <button onClick={test} disabled={testing} className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-body hover:bg-hover disabled:opacity-40">
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Probar"}
              </button>
            )}
          </div>
          {feedback && (
            <div className={cn("flex items-center gap-1.5 text-[11px]", feedback.startsWith("Error") ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
              {feedback.startsWith("Error") ? <AlertCircle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
              {feedback}
            </div>
          )}
          {def.docsUrl && (
            <a href={def.docsUrl} target="_blank" rel="noreferrer" className="block text-[10px] text-violet-600 dark:text-violet-400 hover:underline">
              ¿Dónde consigo la key? →
            </a>
          )}
        </div>
      )}
    </motion.div>
  );
}
