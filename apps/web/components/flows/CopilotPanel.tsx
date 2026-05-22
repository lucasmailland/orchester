"use client";

import { useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import { Sparkles, X, Send, Loader2, Link2 } from "lucide-react";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/**
 * Copiloto del Flow Builder. El usuario describe lo que quiere (y opcionalmente
 * una URL de API) y el copiloto arma el flujo solo. Copys en lenguaje simple.
 */
export function CopilotPanel({
  flowId,
  open,
  onClose,
  onApplyGraph,
  describeFlow,
}: {
  flowId: string;
  open: boolean;
  onClose: () => void;
  onApplyGraph: (nodes: Node[], edges: Edge[]) => void;
  /** Resumen en texto del flujo actual (para explicar/revisar). "" si está vacío. */
  describeFlow: () => string;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  async function send() {
    const prompt = input.trim();
    if (!prompt || busy) return;
    setInput("");
    await dispatch(prompt, prompt);
  }

  async function runQuick(label: string, serverPrompt: string) {
    if (busy) return;
    await dispatch(label, serverPrompt);
  }

  async function dispatch(displayText: string, serverPrompt: string) {
    setError(null);
    setBusy(true);
    setMessages((m) => [...m, { role: "user" as const, content: displayText }]);
    try {
      const r = await fetch(`/api/flows/${flowId}/copilot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: serverPrompt,
          apiUrl: apiUrl.trim() || undefined,
          history: messages,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error ?? "El copiloto no pudo responder.");
        setBusy(false);
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: j.message ?? "Listo." }]);
      if (j.graph && Array.isArray(j.graph.nodes) && j.graph.nodes.length > 0) {
        onApplyGraph(j.graph.nodes as Node[], (j.graph.edges ?? []) as Edge[]);
      }
      if (Array.isArray(j.errors) && j.errors.length > 0) {
        setError(`Algunos pasos no se pudieron crear: ${j.errors.join(" ")}`);
      }
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }), 50);
    } catch {
      setError("Hubo un problema de conexión. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium text-strong">
          <Sparkles className="h-4 w-4 text-violet-500" /> Copiloto
        </span>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted hover:text-body">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">
        {messages.length === 0 && (
          <div className="space-y-2">
            <div className="rounded-xl border border-line bg-card p-3 text-muted">
              <p className="font-medium text-body">Contame qué querés automatizar 👇</p>
              <p className="mt-1 leading-relaxed">
                Por ejemplo: <em>“cuando llega un mensaje, buscá en mi base de conocimiento y
                respondé con un agente”</em>. Si tenés una API, pegá su link y armo el paso por vos.
              </p>
            </div>
            {describeFlow() && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    void runQuick(
                      "Explicame este flujo",
                      `Explicá en lenguaje simple, para alguien no técnico, qué hace este flujo paso a paso:\n\n${describeFlow()}`
                    )
                  }
                  className="rounded-full border border-line bg-card px-2.5 py-1 text-[11px] text-body hover:bg-elevated"
                >
                  Explicame este flujo
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void runQuick(
                      "Revisá si hay errores",
                      `Revisá este flujo y decime, en lenguaje simple, si tiene errores, pasos sin configurar o conexiones faltantes. No uses la herramienta set_flow, solo explicá:\n\n${describeFlow()}`
                    )
                  }
                  className="rounded-full border border-line bg-card px-2.5 py-1 text-[11px] text-body hover:bg-elevated"
                >
                  Revisá si hay errores
                </button>
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-6 rounded-xl bg-violet-500/10 p-3 text-body"
                : "mr-6 rounded-xl border border-line bg-card p-3 text-body"
            }
          >
            {m.content}
          </div>
        ))}
        {busy && (
          <div className="mr-6 flex items-center gap-2 rounded-xl border border-line bg-card p-3 text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Armando el flujo…
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        {showUrl && (
          <div className="mb-2 flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5 text-faint" />
            <input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://api.tu-servicio.com/…"
              className="w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
            />
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Describí lo que querés que haga…"
            className="flex-1 resize-none rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="rounded-lg bg-violet-500 p-2 text-white hover:bg-violet-400 disabled:opacity-40"
            aria-label="Enviar"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowUrl((s) => !s)}
          className="mt-1.5 text-[11px] text-muted hover:text-body"
        >
          {showUrl ? "Quitar link de API" : "+ Agregar link de una API"}
        </button>
      </div>
    </div>
  );
}
