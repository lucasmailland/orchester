"use client";

import { useMemo, useState } from "react";
import { X, KeyRound, Loader2, Search } from "lucide-react";
import {
  providersFor,
  CAPABILITY_LABELS,
  type Capability,
  type ProviderDef,
} from "@/lib/ai/catalog";

/**
 * Modal para conectar un proveedor SIN salir del nodo/agente. Lista los
 * proveedores de la capacidad pedida que aún no están conectados; al elegir uno,
 * pedís la API key y queda conectado al instante.
 */
export function ConnectProviderModal({
  capability,
  connectedIds,
  onClose,
  onConnected,
}: {
  capability: Capability;
  connectedIds: string[];
  onClose: () => void;
  onConnected: (providerId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ProviderDef | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = new Set(connectedIds);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return providersFor(capability)
      .filter((p) => !connected.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capability, query, connectedIds]);

  async function connect() {
    if (!picked || !apiKey.trim()) return;
    setSaving(true);
    setError(null);
    const r = await fetch("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: picked.id, apiKey, endpoint: endpoint || undefined }),
    });
    setSaving(false);
    if (!r.ok) {
      setError("Couldn't connect. Double-check the API key.");
      return;
    }
    onConnected(picked.id);
  }

  const needsEndpoint = picked?.auth === "api_key+endpoint";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-app/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold text-strong">
            Connect a provider · {CAPABILITY_LABELS[capability].emoji}{" "}
            {CAPABILITY_LABELS[capability].es}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-body"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!picked ? (
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search providers…"
                className="w-full rounded-lg border border-line bg-elevated py-2 pl-8 pr-3 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
              />
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {list.length === 0 && (
                <p className="p-2 text-xs text-muted">
                  You&apos;ve already connected every provider for this capability.
                </p>
              )}
              {list.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPicked(p)}
                  className="flex w-full items-center justify-between rounded-lg border border-line bg-card px-3 py-2 text-left text-sm text-body hover:bg-elevated"
                >
                  <span>{p.name}</span>
                  <span className="text-[10px] text-faint">
                    {p.kind === "aggregator" ? "aggregator" : p.kind === "local" ? "local" : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="text-[11px] text-muted hover:text-body"
            >
              ← Pick another
            </button>
            <div className="text-sm font-medium text-strong">{picked.name}</div>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={picked.keyHint ? `API key · ${picked.keyHint}` : "API key"}
                className="w-full rounded-lg border border-line bg-elevated py-2 pl-8 pr-3 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
              />
            </div>
            {needsEndpoint && (
              <input
                type="url"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://… (endpoint)"
                className="w-full rounded-lg border border-line bg-elevated px-2.5 py-2 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
              />
            )}
            {picked.docsUrl && (
              <a
                href={picked.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-[11px] text-violet-600 dark:text-violet-400 hover:underline"
              >
                Where do I get the key? →
              </a>
            )}
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="button"
              onClick={connect}
              disabled={!apiKey.trim() || saving}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-500 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
