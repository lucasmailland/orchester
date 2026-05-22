"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, KeyRound, Eye, EyeOff, Check, AlertCircle, Loader2, Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROVIDERS, MODELS, CAPABILITY_LABELS, type Capability, type ProviderDef, type ModelDef } from "@/lib/ai/catalog";

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

const MODELS_BY_PROVIDER: Record<string, ModelDef[]> = MODELS.reduce((acc, m) => {
  (acc[m.provider] ??= []).push(m);
  return acc;
}, {} as Record<string, ModelDef[]>);

export function AIProvidersSection() {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [capFilter, setCapFilter] = useState<Capability | "all">("all");

  function refresh(updated: ProviderRow | null, providerId: string) {
    setRows((prev) => {
      const others = prev.filter((r) => r.provider !== providerId);
      return updated ? [...others, updated] : others;
    });
  }

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  const connectedIds = useMemo(() => new Set(rows.map((r) => r.provider)), [rows]);
  const connected = PROVIDERS.filter((p) => connectedIds.has(p.id));

  const q = query.trim().toLowerCase();
  const matches = (p: ProviderDef) => {
    if (capFilter !== "all" && !p.capabilities.includes(capFilter)) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.capabilities.some((c) => CAPABILITY_LABELS[c].es.toLowerCase().includes(q))
    );
  };

  // Disponibles (no conectados). Si hay filtro de capacidad activo, agrupamos bajo
  // ESA capacidad; si no, bajo la capacidad primaria de cada proveedor.
  const available = PROVIDERS.filter((p) => !connectedIds.has(p.id) && matches(p));
  const byPrimary: Record<string, ProviderDef[]> = {};
  for (const p of available) {
    const group = capFilter !== "all" ? capFilter : p.capabilities[0]!;
    (byPrimary[group] ??= []).push(p);
  }

  if (loading)
    return (
      <div className="flex h-32 items-center justify-center text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Conectados arriba */}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-strong">
          <Check className="h-4 w-4 text-emerald-500" /> Conectados
          <span className="rounded-full bg-elevated px-1.5 text-[11px] font-normal text-muted">{connected.length}</span>
        </h3>
        {connected.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-card p-3 text-xs text-muted">
            Todavía no conectaste ningún proveedor. Buscá uno abajo y conectalo con tu API key.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {connected.map((p) => (
              <ProviderCard key={p.id} def={p} row={rows.find((r) => r.provider === p.id) ?? null} onChange={(u) => refresh(u, p.id)} />
            ))}
          </div>
        )}
      </section>

      {/* Buscador + filtros */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-strong">Agregar un proveedor</h3>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar proveedor (OpenAI, Replicate, ElevenLabs…)"
            className="w-full rounded-lg border border-line bg-elevated py-2 pl-9 pr-3 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
          />
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Chip active={capFilter === "all"} onClick={() => setCapFilter("all")}>Todas</Chip>
          {CAPABILITY_ORDER.map((c) => (
            <Chip key={c} active={capFilter === c} onClick={() => setCapFilter(c)}>
              {CAPABILITY_LABELS[c].emoji} {CAPABILITY_LABELS[c].es}
            </Chip>
          ))}
        </div>

        {available.length === 0 ? (
          <p className="rounded-xl border border-line bg-card p-3 text-xs text-muted">No hay proveedores que coincidan con la búsqueda.</p>
        ) : (
          <div className="space-y-5">
            {CAPABILITY_ORDER.filter((c) => byPrimary[c]?.length).map((cap) => (
              <div key={cap}>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">
                  {CAPABILITY_LABELS[cap].emoji} {CAPABILITY_LABELS[cap].es}
                </p>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {byPrimary[cap]!.map((p) => (
                    <ProviderCard key={p.id} def={p} row={null} onChange={(u) => refresh(u, p.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
        active ? "border-violet-500/50 bg-violet-500/10 text-violet-600 dark:text-violet-300" : "border-line bg-card text-muted hover:bg-elevated"
      )}
    >
      {children}
    </button>
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
  const [showModels, setShowModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const catalogModels = MODELS_BY_PROVIDER[def.id] ?? [];

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
    if (!r.ok) return setFeedback("Error al guardar");
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
  }

  const connected = !!row;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("rounded-2xl border bg-card p-4", connected ? "border-emerald-500/30" : "border-line")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-strong">{def.name}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-400" : "bg-zinc-600/60")} />
              {connected ? "Conectado" : "No conectado"}
              {def.kind === "aggregator" && <span className="text-faint">· agregador</span>}
              {def.kind === "local" && <span className="text-faint">· local</span>}
            </div>
          </div>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-body hover:bg-hover">
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

      {/* Ver modelos disponibles */}
      {(catalogModels.length > 0 || def.kind === "aggregator") && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowModels((s) => !s)} className="flex items-center gap-1 text-[11px] text-muted hover:text-body">
            <ChevronDown className={cn("h-3 w-3 transition-transform", showModels && "rotate-180")} />
            Ver modelos {catalogModels.length > 0 ? `(${catalogModels.length})` : ""}
          </button>
          {showModels && (
            <div className="mt-1 max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-elevated p-2">
              {catalogModels.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-[10px]">
                  <span className="truncate text-body">{CAPABILITY_LABELS[m.capability].emoji} {m.name}</span>
                  {m.tier && <span className="text-faint">{m.tier}</span>}
                </div>
              ))}
              {def.kind === "aggregator" && (
                <p className="pt-1 text-[10px] text-faint">+ acepta cualquier otro modelo por su id.</p>
              )}
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {row && (
            <div className="flex items-center justify-between rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-[11px]">
              <span className="font-mono text-muted">{row.apiKeyMasked}</span>
              <button onClick={remove} type="button" className="text-muted hover:text-red-600 dark:hover:text-red-400">Quitar</button>
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
            <button onClick={save} disabled={!apiKey.trim() || saving} className="flex-1 rounded-lg bg-violet-500/90 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-40">
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
            <a href={def.docsUrl} target="_blank" rel="noreferrer" className="block text-[10px] text-violet-600 dark:text-violet-400 hover:underline">¿Dónde consigo la key? →</a>
          )}
        </div>
      )}
    </motion.div>
  );
}
