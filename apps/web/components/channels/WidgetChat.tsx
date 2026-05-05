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
    try {
      const r = await fetch(`/api/widget/${channelId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visitorId, text: text.trim() }),
      });
      const j = await r.json();
      if (r.ok) {
        setMessages((prev) => [...prev, { role: "assistant", content: j.reply ?? "" }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Lo siento, hubo un error." },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sin conexión, intentá de nuevo." },
      ]);
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
