"use client";

import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  channelId: string;
  color: string;
  title: string;
  greeting: string;
  starters: string[];
  placeholder: string;
}

const VISITOR_KEY = "orch_visitor_id";

export function WidgetChat({ channelId, color, title, greeting, starters, placeholder }: Props) {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: greeting },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [visitorId, setVisitorId] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let id = "";
    try {
      id = localStorage.getItem(VISITOR_KEY) ?? "";
      if (!id) {
        id = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(VISITOR_KEY, id);
      }
    } catch {
      id = "v_" + Math.random().toString(36).slice(2);
    }
    setVisitorId(id);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setInput("");
    setLoading(true);

    // Placeholder vacío que vamos llenando con los deltas del stream.
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    // Batch de render cada 50ms para no spamear React con cada token.
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
    };
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush();
      }, 50);
    };
    const setLast = (content: string) =>
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant") return prev;
        return [...prev.slice(0, -1), { ...last, content }];
      });

    try {
      const r = await fetch(`/api/widget/${channelId}/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visitorId, text: text.trim() }),
      });
      if (!r.ok || !r.body) {
        setLast("Lo siento, hubo un error.");
        return;
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let gotText = false;
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
                | { type: "done"; reply: string }
                | { type: "error"; error: string };
              if (ev.type === "text") {
                gotText = true;
                buffered += ev.delta;
                scheduleFlush();
              } else if (ev.type === "done") {
                if (flushTimer) {
                  clearTimeout(flushTimer);
                  flushTimer = null;
                }
                flush();
                // Si no llegó ningún delta (p.ej. flow sin reply), usamos
                // el reply final del done para no dejar la burbuja vacía.
                if (!gotText && ev.reply) setLast(ev.reply);
              } else if (ev.type === "error") {
                setLast("Lo siento, hubo un error.");
              }
            } catch {
              // ignorar líneas mal formadas
            }
          }
        }
      }
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flush();
    } catch {
      setLast("Sin conexión, intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0a0a0a",
        color: "#f4f4f5",
      }}
    >
      <header
        style={{
          padding: "14px 16px",
          background: color,
          color: "white",
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        {title}
      </header>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              marginBottom: 10,
            }}
          >
            <div
              style={{
                maxWidth: "85%",
                padding: "8px 12px",
                borderRadius: 14,
                fontSize: 13,
                lineHeight: 1.45,
                background: m.role === "user" ? color : "rgba(255,255,255,0.08)",
                color: m.role === "user" ? "white" : "#e4e4e7",
                whiteSpace: "pre-wrap",
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ fontSize: 11, color: "#71717a", paddingLeft: 4 }}>Escribiendo…</div>
        )}
      </div>
      {messages.length <= 1 && starters.length > 0 && (
        <div style={{ padding: "0 14px 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {starters.slice(0, 4).map((s, i) => (
            <button
              key={i}
              onClick={() => send(s)}
              type="button"
              style={{
                fontSize: 11,
                padding: "5px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "transparent",
                color: "#a1a1aa",
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div
        style={{
          padding: 10,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          gap: 8,
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={placeholder}
          style={{
            flex: 1,
            padding: "9px 12px",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            color: "white",
            borderRadius: 10,
            fontSize: 13,
            outline: "none",
          }}
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          type="button"
          style={{
            padding: "9px 14px",
            border: "none",
            background: color,
            color: "white",
            borderRadius: 10,
            cursor: input.trim() && !loading ? "pointer" : "not-allowed",
            opacity: input.trim() && !loading ? 1 : 0.5,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
