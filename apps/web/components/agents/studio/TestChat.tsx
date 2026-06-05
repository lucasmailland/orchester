"use client";

import { useRef, useState } from "react";
import { Send, Trash2, Loader2, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";

interface ToolCallView {
  name: string;
  input: unknown;
  output: unknown;
  error?: string;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallView[];
  flowRunId?: string;
}

interface Props {
  agentId: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens?: number | undefined;
  variables?: Record<string, string>;
  tools?: string[];
}

export function TestChat({
  agentId,
  systemPrompt,
  model,
  temperature,
  maxTokens,
  variables,
  tools,
}: Props) {
  const t = useTranslations("pages.agents.studio.testChat");
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

    // Si el agente tiene tools, no podemos streamear (test-chat-stream NO ejecuta
    // tools — solo genera tokens). Caemos al endpoint blocking.
    const hasTools = (tools?.length ?? 0) > 0;

    if (hasTools) {
      try {
        const r = await fetch(`/api/agents/${agentId}/test-chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: next.map(({ role, content }) => ({ role, content })),
            systemPrompt,
            model,
            temperature,
            maxTokens,
            variables,
            tools,
          }),
        });
        const j = await r.json();
        if (!r.ok) {
          if (j.error === "PROVIDER_NOT_CONFIGURED") setError(t("providerNotConfigured"));
          else setError(j.error || t("genericError"));
          return;
        }
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: j.content, toolCalls: j.toolCalls, flowRunId: j.flowRunId },
        ]);
        setTokens((t) => t + (j.tokensUsed ?? 0));
        setTimeout(() => scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" }), 50);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Streaming path ─────────────────────────────────────────────
    // Append placeholder vacío que vamos a ir llenando.
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const r = await fetch(`/api/agents/${agentId}/test-chat-stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
          systemPrompt,
          model,
          temperature,
          maxTokens,
          variables,
        }),
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? t("genericError"));
        // remover placeholder
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let buffered = "";
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        if (!buffered) return;
        const chunk = buffered;
        buffered = "";
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== "assistant") return prev;
          return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
        });
        scrollRef.current?.scrollTo({ top: 99999 });
      };
      const scheduleFlush = () => {
        if (flushTimer) return;
        // Batch render cada 50ms para no spammear React con cada token.
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flush();
        }, 50);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const json = line.slice(5).trim();
            if (!json) continue;
            try {
              const ev = JSON.parse(json) as
                | { type: "text"; delta: string }
                | { type: "done"; tokensUsed: number }
                | { type: "error"; error: string };
              if (ev.type === "text") {
                buffered += ev.delta;
                scheduleFlush();
              } else if (ev.type === "done") {
                if (flushTimer) {
                  clearTimeout(flushTimer);
                  flushTimer = null;
                }
                flush();
                setTokens((t) => t + (ev.tokensUsed ?? 0));
              } else if (ev.type === "error") {
                setError(ev.error);
                setMessages((prev) => prev.slice(0, -1));
              }
            } catch {
              // ignorar líneas mal formadas
            }
          }
        }
      }
      // flush final por si quedó algo en el buffer
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flush();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-xs font-medium text-body">{t("title")}</span>
        <button
          onClick={() => {
            setMessages([]);
            setTokens(0);
            setError(null);
          }}
          className="text-muted hover:text-red-600 dark:hover:text-red-400"
          type="button"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="mt-8 text-center text-xs text-muted">{t("emptyHint")}</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className="space-y-1.5">
            <div
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-violet-500/20 px-3.5 py-2 text-sm text-strong"
                  : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-line bg-elevated px-3.5 py-2 text-sm text-strong"
              }
            >
              {m.content || (m.flowRunId ? t("ranByFlow") : "")}
            </div>
            {m.toolCalls && m.toolCalls.length > 0 && (
              <div className="mr-auto max-w-[85%] space-y-1">
                {m.toolCalls.map((tc, j) => (
                  <details
                    key={j}
                    className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11px]"
                  >
                    <summary className="flex cursor-pointer items-center gap-1.5 text-body">
                      <Wrench className="h-3 w-3 text-violet-600 dark:text-violet-400" /> {tc.name}
                      {tc.error && (
                        <span className="ml-auto text-red-600 dark:text-red-400">
                          {t("errorBadge")}
                        </span>
                      )}
                    </summary>
                    <pre className="mt-1.5 max-h-40 overflow-y-auto rounded bg-black/40 p-2 font-mono text-[10px] text-muted">
                      {JSON.stringify(
                        { input: tc.input, output: tc.output, error: tc.error },
                        null,
                        2
                      )}
                    </pre>
                  </details>
                ))}
              </div>
            )}
            {m.flowRunId && (
              <div className="mr-auto text-[10px] text-faint">
                {t("flowRun")} {m.flowRunId.slice(0, 8)}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="mr-auto flex items-center gap-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("thinking")}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
      <div className="border-t border-line p-3">
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
            aria-label={t("messageAria")}
            placeholder={t("messagePlaceholder")}
            className="flex-1 resize-none rounded-xl border border-line bg-elevated px-3 py-2 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            aria-label={t("sendAria")}
            className="rounded-xl bg-violet-500 p-2.5 text-white hover:bg-violet-400 disabled:opacity-40"
            type="button"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-faint">
          <span>
            {t("tokensUsed")} {tokens}
          </span>
          {tools && tools.length > 0 && (
            <span className="flex items-center gap-1">
              <Wrench className="h-2.5 w-2.5" /> {tools.length}{" "}
              {tools.length !== 1 ? t("tools") : t("tool")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
