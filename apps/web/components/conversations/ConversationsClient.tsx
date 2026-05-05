"use client";

import { useEffect, useState } from "react";
import { Search, X, MessageSquare, User, Bot, Tag as TagIcon, UserCheck } from "lucide-react";
import { toast } from "sonner";

interface Conv {
  id: string;
  status: "open" | "closed" | "escalated";
  channelType: string | null;
  channelName: string | null;
  agentId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  tags: string[] | null;
  csat: number | null;
  messageCount: number;
  startedAt: string;
  takenOverAt: string | null;
  summary: string | null;
}
interface Msg {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  fromOperator: boolean;
  createdAt: string;
}
interface Agent {
  id: string;
  name: string;
}
interface Label {
  id: string;
  name: string;
  color: string;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Abierta",
  closed: "Cerrada",
  escalated: "Escalada",
};

export function ConversationsClient({
  agents,
  labels,
}: {
  agents: Agent[];
  labels: Label[];
}) {
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: "",
    channel: "",
    agentId: "",
    tag: "",
    search: "",
  });
  const [selected, setSelected] = useState<Conv | null>(null);

  async function load() {
    setLoading(true);
    const qs = new URLSearchParams();
    if (filters.status) qs.set("status", filters.status);
    if (filters.channel) qs.set("channel", filters.channel);
    if (filters.agentId) qs.set("agentId", filters.agentId);
    if (filters.tag) qs.set("tag", filters.tag);
    if (filters.search) qs.set("search", filters.search);
    const r = await fetch(`/api/conversations?${qs}`);
    const j = await r.json();
    setConversations(Array.isArray(j) ? j : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function exportCsv() {
    const rows = [
      [
        "id",
        "status",
        "channel",
        "customerName",
        "customerEmail",
        "messageCount",
        "csat",
        "startedAt",
        "summary",
      ],
      ...conversations.map((c) => [
        c.id,
        c.status,
        c.channelType ?? "",
        c.customerName ?? "",
        c.customerEmail ?? "",
        String(c.messageCount),
        c.csat?.toString() ?? "",
        c.startedAt,
        (c.summary ?? "").replace(/"/g, '""'),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conversations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV descargado");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
            Conversaciones
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Cada interacción con un agente, en cada canal.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={conversations.length === 0}
          className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-40"
        >
          Exportar CSV
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
          <input
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Buscar nombre, email o resumen…"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 py-1.5 pl-8 pr-2 text-xs text-zinc-100 outline-none focus:border-violet-500/60"
          />
        </div>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
        >
          <option value="">Estado · Todos</option>
          <option value="open">Abiertas</option>
          <option value="escalated">Escaladas</option>
          <option value="closed">Cerradas</option>
        </select>
        <select
          value={filters.channel}
          onChange={(e) => setFilters({ ...filters, channel: e.target.value })}
          className="rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
        >
          <option value="">Canal · Todos</option>
          <option value="widget">Web Widget</option>
          <option value="telegram">Telegram</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="slack">Slack</option>
          <option value="email">Email</option>
          <option value="api">API</option>
        </select>
        <select
          value={filters.agentId}
          onChange={(e) => setFilters({ ...filters, agentId: e.target.value })}
          className="rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
        >
          <option value="">Agente · Todos</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {labels.length > 0 && (
          <select
            value={filters.tag}
            onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
            className="rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
          >
            <option value="">Tag · Todos</option>
            {labels.map((l) => (
              <option key={l.id} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-xs text-zinc-500">Cargando…</div>
      ) : conversations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center">
          <MessageSquare className="mx-auto mb-3 h-8 w-8 text-zinc-600" />
          <h3 className="text-sm font-medium text-zinc-200">Sin conversaciones</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Cuando un agente reciba mensajes, vas a verlos acá.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c)}
              className="flex w-full items-center gap-3 border-b border-white/[0.05] bg-zinc-900/30 px-4 py-3 text-left text-xs hover:bg-zinc-900/60 last:border-b-0"
            >
              <div
                className={
                  c.status === "open"
                    ? "h-2 w-2 rounded-full bg-emerald-400"
                    : c.status === "escalated"
                    ? "h-2 w-2 rounded-full bg-amber-400"
                    : "h-2 w-2 rounded-full bg-zinc-700"
                }
              />
              <div className="flex-1">
                <div className="flex items-center gap-2 text-zinc-100">
                  <span className="font-medium">
                    {c.customerName ?? c.customerEmail ?? "Anónimo"}
                  </span>
                  {c.takenOverAt && (
                    <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">
                      take-over
                    </span>
                  )}
                  {(c.tags ?? []).map((t) => (
                    <span
                      key={t}
                      className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[9px] text-violet-300"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  {c.channelType ?? "—"} · {c.messageCount} mensajes ·{" "}
                  {new Date(c.startedAt).toLocaleString()}
                  {c.csat != null && ` · CSAT ${c.csat}/5`}
                </div>
              </div>
              <span className="text-[10px] text-zinc-600">{STATUS_LABEL[c.status]}</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <ConversationDrawer
          conversation={selected}
          labels={labels}
          onClose={() => setSelected(null)}
          onUpdated={() => load()}
        />
      )}
    </div>
  );
}

function ConversationDrawer({
  conversation,
  labels,
  onClose,
  onUpdated,
}: {
  conversation: Conv;
  labels: Label[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(conversation.status);
  const [tags, setTags] = useState<string[]>(conversation.tags ?? []);

  useEffect(() => {
    fetch(`/api/conversations/${conversation.id}`)
      .then((r) => r.json())
      .then((d) => setMessages(d?.messages ?? []));
  }, [conversation.id]);

  async function takeOver() {
    setBusy(true);
    await fetch(`/api/conversations/${conversation.id}/takeover`, { method: "POST" });
    setBusy(false);
    toast.success("Conversación tomada");
    onUpdated();
  }

  async function release() {
    setBusy(true);
    await fetch(`/api/conversations/${conversation.id}/takeover`, { method: "DELETE" });
    setBusy(false);
    toast.success("Devuelta al agente");
    onUpdated();
  }

  async function sendReply() {
    if (!reply.trim()) return;
    setBusy(true);
    const r = await fetch(`/api/conversations/${conversation.id}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: reply }),
    });
    setBusy(false);
    if (r.ok) {
      setReply("");
      toast.success("Mensaje enviado");
      const j = await fetch(`/api/conversations/${conversation.id}`).then((x) => x.json());
      setMessages(j?.messages ?? []);
    } else toast.error("No se pudo enviar");
  }

  async function changeStatus(s: "open" | "closed" | "escalated") {
    setStatus(s);
    await fetch(`/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: s }),
    });
    onUpdated();
  }

  async function toggleTag(name: string) {
    const next = tags.includes(name) ? tags.filter((t) => t !== name) : [...tags, name];
    setTags(next);
    await fetch(`/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: next }),
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="flex h-full w-[560px] flex-col border-l border-white/[0.06] bg-zinc-950">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <div className="flex items-center gap-2 text-sm text-zinc-100">
            <User className="h-4 w-4 text-zinc-500" />
            <span className="font-medium">
              {conversation.customerName ?? conversation.customerEmail ?? "Anónimo"}
            </span>
            <span className="text-[11px] text-zinc-500">· {conversation.channelType}</span>
          </div>
          <button onClick={onClose} type="button" className="text-zinc-500 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-5 py-2.5 text-xs">
          <select
            value={status}
            onChange={(e) => changeStatus(e.target.value as "open" | "closed" | "escalated")}
            className="rounded-md border border-white/[0.08] bg-zinc-800/40 px-2 py-1 text-zinc-200 outline-none"
          >
            <option value="open">Abierta</option>
            <option value="escalated">Escalada</option>
            <option value="closed">Cerrada</option>
          </select>
          {!conversation.takenOverAt ? (
            <button
              type="button"
              onClick={takeOver}
              disabled={busy}
              className="flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-amber-300 hover:bg-amber-500/25"
            >
              <UserCheck className="h-3 w-3" /> Tomar
            </button>
          ) : (
            <button
              type="button"
              onClick={release}
              disabled={busy}
              className="rounded-md bg-emerald-500/15 px-2 py-1 text-emerald-300 hover:bg-emerald-500/25"
            >
              Devolver al agente
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <TagIcon className="h-3 w-3 text-zinc-500" />
            {labels.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => toggleTag(l.name)}
                className={
                  tags.includes(l.name)
                    ? "rounded-md bg-violet-500/25 px-1.5 py-0.5 text-[10px] text-violet-200"
                    : "rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
                }
              >
                {l.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
                  : "mr-auto max-w-[80%] rounded-2xl rounded-bl-sm border border-white/5 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100"
              }
            >
              {m.fromOperator && (
                <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-400">
                  <UserCheck className="h-2.5 w-2.5" /> Operador
                </div>
              )}
              {!m.fromOperator && m.role === "assistant" && (
                <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-violet-400">
                  <Bot className="h-2.5 w-2.5" /> Agente
                </div>
              )}
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          ))}
        </div>

        <div className="border-t border-white/[0.06] p-3">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendReply();
              }
            }}
            rows={2}
            placeholder={
              conversation.takenOverAt ? "Responder como operador…" : "Tomá la conversación para escribir como humano"
            }
            disabled={!conversation.takenOverAt && conversation.status !== "escalated"}
            className="w-full resize-none rounded-lg border border-white/[0.08] bg-zinc-800/40 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={sendReply}
            disabled={busy || !reply.trim()}
            className="mt-1.5 w-full rounded-lg bg-violet-500 py-2 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
