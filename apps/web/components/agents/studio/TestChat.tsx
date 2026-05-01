"use client";

import { useRef, useState } from "react";
import { Send, Trash2, Loader2 } from "lucide-react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  agentId: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens?: number | undefined;
}

export function TestChat({ agentId, systemPrompt, model, temperature, maxTokens }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send() {
    if (!input.trim() || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: input.trim() }];
    setMessages(next);
    setInput("");
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/agents/${agentId}/test-chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next, systemPrompt, model, temperature, maxTokens }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.error === "PROVIDER_NOT_CONFIGURED")
          setError("Configurá el proveedor en Ajustes para usar este modelo.");
        else setError(j.error || "Error");
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: j.content }]);
      setTokens((t) => t + (j.tokensUsed ?? 0));
      setTimeout(() => scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.08] bg-zinc-900/40">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <span className="text-xs font-medium text-zinc-300">Test chat</span>
        <button
          onClick={() => {
            setMessages([]);
            setTokens(0);
            setError(null);
          }}
          className="text-zinc-500 hover:text-red-400"
          type="button"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="mt-8 text-center text-xs text-zinc-500">
            Escribí un mensaje para probar al agente con la configuración actual.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-violet-500/20 px-3.5 py-2 text-sm text-zinc-100"
                : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-white/5 bg-zinc-800/60 px-3.5 py-2 text-sm text-zinc-100"
            }
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="mr-auto flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando…
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>
      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Escribí un mensaje…"
            className="flex-1 resize-none rounded-xl border border-white/[0.08] bg-zinc-800/40 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="rounded-xl bg-violet-500 p-2.5 text-white hover:bg-violet-400 disabled:opacity-40"
            type="button"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-1.5 text-[10px] text-zinc-600">Tokens usados: {tokens}</div>
      </div>
    </div>
  );
}
