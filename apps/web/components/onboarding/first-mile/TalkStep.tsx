"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";
import { ArrowRight, Loader2, Send } from "lucide-react";

interface Props {
  agent: { id: string; name: string; model: string; systemPrompt: string };
  onFirstReply: (replyText: string) => void;
  onContinue: () => void;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/**
 * Step 4 — Talk to the new agent.
 *
 * Uses the existing `POST /api/agents/{id}/test-chat` blocking endpoint. The
 * "Continue" button is disabled until the user has sent ≥1 message AND
 * received ≥1 assistant reply.
 */
export function TalkStep({ agent, onFirstReply, onContinue }: Props) {
  const t = useTranslations("compass.onboarding.talk");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasReply, setHasReply] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const replyNotifiedRef = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}/test-chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          temperature: 0.7,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? t("errorFallback"));
        return;
      }
      const data = (await res.json()) as { content?: string };
      const reply = data.content?.trim() ?? "";
      if (!reply) {
        setError(t("errorEmpty"));
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      setHasReply(true);
      if (!replyNotifiedRef.current) {
        replyNotifiedRef.current = true;
        onFirstReply(reply);
      }
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="onboarding-talk-heading" className="flex flex-col gap-4">
      <header className="space-y-2">
        <h1 id="onboarding-talk-heading" className="text-2xl font-semibold text-text-strong">
          {t("heading", { name: agent.name })}
        </h1>
        <p className="text-sm leading-relaxed text-text-muted">{t("subhead")}</p>
      </header>

      <div
        ref={scrollRef}
        aria-live="polite"
        aria-label={t("chatLabel")}
        className="flex h-64 flex-col gap-2 overflow-y-auto rounded-xl border border-line bg-elevated/30 p-3"
      >
        {messages.length === 0 && (
          <p className="m-auto text-xs text-text-muted">{t("emptyHint")}</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
              m.role === "user"
                ? "ml-auto bg-violet-600 text-white"
                : "mr-auto bg-card text-text-strong border border-line"
            }`}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="mr-auto flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="animate-spin" size={14} /> {t("thinking")}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={t("inputPlaceholder")}
          aria-label={t("inputLabel")}
          disabled={loading}
          className="flex-1 rounded-xl border border-line bg-card px-3 py-2 text-sm focus:border-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-600/30"
        />
        <Button
          type="button"
          color="primary"
          isIconOnly
          isLoading={loading}
          isDisabled={!input.trim() || loading}
          onPress={send}
          className="bg-violet-600"
          aria-label={t("sendLabel")}
        >
          <Send size={16} />
        </Button>
      </div>

      <Button
        type="button"
        color="primary"
        size="lg"
        endContent={<ArrowRight size={16} />}
        isDisabled={!hasReply}
        onPress={onContinue}
        className="bg-violet-600 font-semibold"
      >
        {t("cta")}
      </Button>
    </section>
  );
}
