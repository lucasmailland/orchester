"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, KeyRound, Eye, EyeOff, Check, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ProviderId = "anthropic" | "openai" | "google" | "azure_openai";

interface ProviderRow {
  id: string;
  provider: ProviderId;
  apiKeyMasked: string;
  endpoint: string | null;
  enabled: boolean;
  models: Array<{ id: string; name: string; tier: string }>;
  lastTestStatus: string | null;
  lastTestError: string | null;
}

const META: Record<ProviderId, { name: string; placeholder: string; needsEndpoint?: boolean }> = {
  anthropic: { name: "Anthropic", placeholder: "sk-ant-api03-..." },
  openai: { name: "OpenAI", placeholder: "sk-..." },
  google: { name: "Google AI", placeholder: "AIza..." },
  azure_openai: { name: "Azure OpenAI", placeholder: "<api key>", needsEndpoint: true },
};

export function AIProvidersSection() {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="flex h-32 items-center justify-center text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(Object.keys(META) as ProviderId[]).map((p) => (
        <ProviderCard
          key={p}
          provider={p}
          row={rows.find((r) => r.provider === p) ?? null}
          onChange={(updated) => {
            setRows((prev) => {
              const others = prev.filter((r) => r.provider !== p);
              return updated ? [...others, updated] : others;
            });
          }}
        />
      ))}
    </div>
  );
}

function ProviderCard({
  provider,
  row,
  onChange,
}: {
  provider: ProviderId;
  row: ProviderRow | null;
  onChange: (r: ProviderRow | null) => void;
}) {
  const meta = META[provider];
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState(row?.endpoint ?? "");
  const [show, setShow] = useState(false);
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
      body: JSON.stringify({ provider, apiKey, endpoint: endpoint || undefined }),
    });
    setSaving(false);
    if (!r.ok) {
      setFeedback("Error al guardar");
      return;
    }
    setApiKey("");
    setFeedback("Guardado");
    const all = await fetch("/api/providers").then((x) => x.json());
    onChange(all.find((x: ProviderRow) => x.provider === provider) ?? null);
  }

  async function test() {
    if (!row) return;
    setTesting(true);
    setFeedback(null);
    const r = await fetch(`/api/providers/${row.id}/test`, { method: "POST" });
    const j = await r.json();
    setTesting(false);
    if (j.ok) {
      setFeedback(`OK · ${j.models?.length ?? 0} modelos`);
      const all = await fetch("/api/providers").then((x) => x.json());
      onChange(all.find((x: ProviderRow) => x.provider === provider) ?? null);
    } else {
      setFeedback(`Error: ${j.error}`);
    }
  }

  async function remove() {
    if (!row) return;
    await fetch(`/api/providers/${row.id}`, { method: "DELETE" });
    onChange(null);
    setApiKey("");
    setFeedback(null);
  }

  const status = row?.lastTestStatus;
  const dot =
    status === "ok"
      ? "bg-emerald-400"
      : status === "error"
      ? "bg-red-400"
      : row
      ? "bg-amber-400"
      : "bg-zinc-700";
  const statusLabel = !row
    ? "No configurado"
    : status === "ok"
    ? "Conectado"
    : status === "error"
    ? "Error"
    : "Sin probar";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-line bg-card p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-strong">{meta.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
              {statusLabel}
            </div>
          </div>
        </div>
        {row && (
          <button onClick={remove} className="text-xs text-muted hover:text-red-600 dark:hover:text-red-400" type="button">
            Quitar
          </button>
        )}
      </div>

      {row && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-line bg-elevated px-3 py-2 text-xs">
          <span className="font-mono text-muted">{row.apiKeyMasked}</span>
          <span className="text-muted">{row.models.length} modelos</span>
        </div>
      )}

      <div className="space-y-2">
        <div className="relative">
          <label htmlFor={`provider-key-${provider}`} className="sr-only">
            API key de {meta.name}
          </label>
          <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden="true" />
          <input
            id={`provider-key-${provider}`}
            name={`provider-key-${provider}`}
            autoComplete="off"
            type={show ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={row ? "Reemplazar key…" : meta.placeholder}
            className="w-full rounded-lg border border-line bg-elevated py-2 pl-9 pr-9 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
          />
          <button
            onClick={() => setShow((s) => !s)}
            type="button"
            aria-label={show ? "Ocultar API key" : "Mostrar API key"}
            className="absolute right-2.5 top-2.5 text-muted hover:text-body"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {meta.needsEndpoint && (
          <>
            <label htmlFor={`provider-endpoint-${provider}`} className="sr-only">
              Endpoint personalizado para {meta.name}
            </label>
            <input
              id={`provider-endpoint-${provider}`}
              name={`provider-endpoint-${provider}`}
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://my-resource.openai.azure.com"
              className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
            />
          </>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={!apiKey.trim() || saving}
          className="flex-1 rounded-lg bg-violet-500/90 py-2 text-xs font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {row && (
          <button
            onClick={test}
            disabled={testing}
            className="rounded-lg border border-line px-3 py-2 text-xs text-body hover:bg-hover disabled:opacity-40"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Probar"}
          </button>
        )}
      </div>

      {feedback && (
        <div
          className={cn(
            "mt-2 flex items-center gap-1.5 text-xs",
            feedback.startsWith("Error") ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
          )}
        >
          {feedback.startsWith("Error") ? <AlertCircle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          {feedback}
        </div>
      )}

      {row?.models && row.models.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted hover:text-body">
            Ver modelos disponibles
          </summary>
          <ul className="mt-2 space-y-1 text-muted">
            {row.models.map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                <span className="font-mono">{m.id}</span>
                <span className="text-faint">{m.tier}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </motion.div>
  );
}
