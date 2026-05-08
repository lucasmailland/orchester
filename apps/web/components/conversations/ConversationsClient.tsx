"use client";

import { useEffect, useState } from "react";
import { Search, X, MessageSquare, User, Bot, Tag as TagIcon, UserCheck, DollarSign } from "lucide-react";
import { toast } from "sonner";

interface Conv {
  id: string;
  status: "open" | "closed" | "escalated";
  channelType: string | null;
  channelName: string | null;
  agentId: string | null;
  agentName: string | null;
  employeeName: string | null;
  employeeEmail: string | null;
  customerName: string | null;
  customerEmail: string | null;
  tags: string[] | null;
  csat: number | null;
  messageCount: number;
  startedAt: string;
  takenOverAt: string | null;
  summary: string | null;
  totalCostUsd: string | null;
  totalTokens: number | null;
}
interface Msg {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  fromOperator: boolean;
  createdAt: string;
  costUsd: string | null;
  tokensUsed: number | null;
  model: string | null;
  metadata?: Record<string, unknown> | null;
}
interface BudgetStatus {
  allowed: boolean;
  budgetUsd: number | null;
  spentUsd: number;
  conversationCount: number;
}

/**
 * Formatea costos en USD con precisión adecuada al rango.
 * <$0.01 → 4 decimales (sub-cent), <$1 → 3 decimales, ≥$1 → 2 decimales.
 */
function fmtUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [filters, setFilters] = useState({
    status: "",
    channel: "",
    agentId: "",
    tag: "",
    search: "",
  });
  const [selected, setSelected] = useState<Conv | null>(null);

  const PAGE_SIZE = 50;

  function buildQs(offset: number): URLSearchParams {
    const qs = new URLSearchParams();
    if (filters.status) qs.set("status", filters.status);
    if (filters.channel) qs.set("channel", filters.channel);
    if (filters.agentId) qs.set("agentId", filters.agentId);
    if (filters.tag) qs.set("tag", filters.tag);
    if (filters.search) qs.set("search", filters.search);
    qs.set("limit", String(PAGE_SIZE));
    qs.set("offset", String(offset));
    return qs;
  }

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/conversations?${buildQs(0)}`);
    const j = await r.json();
    // Soporta tanto el formato nuevo {rows,hasMore} como el viejo (array) para
    // compatibilidad mientras hay caches en vuelo.
    if (Array.isArray(j)) {
      setConversations(j);
      setHasMore(false);
      setNextOffset(null);
    } else {
      setConversations(j.rows ?? []);
      setHasMore(Boolean(j.hasMore));
      setNextOffset(j.nextOffset ?? null);
    }
    setLoading(false);
  }

  async function loadMore() {
    if (nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    const r = await fetch(`/api/conversations?${buildQs(nextOffset)}`);
    const j = await r.json();
    const more: Conv[] = Array.isArray(j) ? j : (j.rows ?? []);
    setConversations((prev) => [...prev, ...more]);
    if (Array.isArray(j)) {
      setHasMore(false);
      setNextOffset(null);
    } else {
      setHasMore(Boolean(j.hasMore));
      setNextOffset(j.nextOffset ?? null);
    }
    setLoadingMore(false);
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
          <label htmlFor="conv-search" className="sr-only">
            Buscar conversaciones
          </label>
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
          <input
            id="conv-search"
            name="conv-search"
            type="search"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Buscar nombre, email o resumen…"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 py-1.5 pl-8 pr-2 text-xs text-zinc-100 outline-none focus:border-violet-500/60"
          />
        </div>
        <label htmlFor="conv-filter-status" className="sr-only">
          Filtrar por estado
        </label>
        <select
          id="conv-filter-status"
          name="status"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
        >
          <option value="">Estado · Todos</option>
          <option value="open">Abiertas</option>
          <option value="escalated">Escaladas</option>
          <option value="closed">Cerradas</option>
        </select>
        <label htmlFor="conv-filter-channel" className="sr-only">
          Filtrar por canal
        </label>
        <select
          id="conv-filter-channel"
          name="channel"
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
        <label htmlFor="conv-filter-agent" className="sr-only">
          Filtrar por agente
        </label>
        <select
          id="conv-filter-agent"
          name="agent"
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
                    {c.employeeName ?? c.customerName ?? c.customerEmail ?? c.employeeEmail ?? "Anónimo"}
                  </span>
                  {c.agentName && (
                    <span className="text-[10px] text-zinc-500">
                      con <span className="text-zinc-300">{c.agentName}</span>
                    </span>
                  )}
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
                  {c.totalCostUsd != null && Number(c.totalCostUsd) > 0 && (
                    <span className="ml-1 text-emerald-400/80">
                      · {fmtUsd(Number(c.totalCostUsd))}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-[10px] text-zinc-600">{STATUS_LABEL[c.status]}</span>
            </button>
          ))}
          {hasMore && (
            <div className="flex items-center justify-center border-t border-white/[0.05] bg-zinc-900/40 py-3">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-1.5 text-xs text-zinc-300 transition-colors hover:border-violet-500/40 hover:bg-violet-500/5 disabled:opacity-50"
              >
                {loadingMore ? "Cargando…" : `Cargar ${PAGE_SIZE} más`}
              </button>
            </div>
          )}
          <div className="border-t border-white/[0.05] bg-zinc-900/20 px-4 py-2 text-center text-[10px] text-zinc-600">
            Mostrando {conversations.length} {hasMore ? "(hay más)" : ""}
          </div>
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
  const [budget, setBudget] = useState<BudgetStatus | null>(null);

  useEffect(() => {
    fetch(`/api/conversations/${conversation.id}`)
      .then((r) => r.json())
      .then((d) => {
        setMessages(d?.messages ?? []);
        setBudget(d?.budget ?? null);
      });
  }, [conversation.id]);

  const totalCost = conversation.totalCostUsd != null ? Number(conversation.totalCostUsd) : 0;
  const totalTokens = conversation.totalTokens ?? 0;

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
              {conversation.employeeName ?? conversation.customerName ?? conversation.customerEmail ?? conversation.employeeEmail ?? "Anónimo"}
            </span>
            {conversation.agentName && (
              <span className="text-[11px] text-zinc-500">· con {conversation.agentName}</span>
            )}
            <span className="text-[11px] text-zinc-500">· {conversation.channelType}</span>
          </div>
          <button onClick={onClose} type="button" className="text-zinc-500 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Resumen de costo + budget del empleado (Sprint C3) */}
        {(totalCost > 0 || budget) && (
          <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] bg-zinc-900/40 px-5 py-2 text-[11px]">
            <div className="flex items-center gap-1.5 text-emerald-300">
              <DollarSign className="h-3 w-3" />
              <span className="font-medium">{fmtUsd(totalCost)}</span>
              <span className="text-zinc-600">
                · {totalTokens.toLocaleString()} tokens
              </span>
            </div>
            {budget && budget.budgetUsd != null && (
              <BudgetMeter budget={budget} />
            )}
            {budget && budget.budgetUsd == null && budget.spentUsd > 0 && (
              <span className="text-zinc-500">
                Empleado: {fmtUsd(budget.spentUsd)} este mes (sin límite)
              </span>
            )}
          </div>
        )}

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
          {messages.map((m) => {
            const reason =
              m.metadata && typeof m.metadata === "object"
                ? (m.metadata as { reason?: string }).reason
                : undefined;
            const isBudgetExceeded = reason === "budget_exceeded";
            const cost = m.costUsd != null ? Number(m.costUsd) : 0;
            return (
              <div
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
                    : isBudgetExceeded
                    ? "mr-auto max-w-[80%] rounded-2xl rounded-bl-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
                    : "mr-auto max-w-[80%] rounded-2xl rounded-bl-sm border border-white/5 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100"
                }
              >
                {m.fromOperator && (
                  <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-400">
                    <UserCheck className="h-2.5 w-2.5" /> Operador
                  </div>
                )}
                {!m.fromOperator && m.role === "assistant" && !isBudgetExceeded && (
                  <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-violet-400">
                    <Bot className="h-2.5 w-2.5" /> Agente
                  </div>
                )}
                {isBudgetExceeded && (
                  <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-rose-300">
                    <DollarSign className="h-2.5 w-2.5" /> Budget excedido
                  </div>
                )}
                <div className="whitespace-pre-wrap">{m.content}</div>
                {/* Footer: tokens + costo + modelo. Solo en mensajes del agente que sí
                    consumieron LLM (budget_exceeded los muestra el banner rojo). */}
                {m.role === "assistant" && !m.fromOperator && (m.tokensUsed ?? 0) > 0 && (
                  <div className="mt-1 flex items-center gap-2 border-t border-white/5 pt-1 text-[9px] text-zinc-500">
                    <span>{m.tokensUsed} tokens</span>
                    {cost > 0 && <span className="text-emerald-400/70">{fmtUsd(cost)}</span>}
                    {m.model && <span className="text-zinc-600">{m.model}</span>}
                  </div>
                )}
              </div>
            );
          })}
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

/**
 * Pill compacto que muestra cuánto del budget mensual del empleado se usó.
 * Verde <70%, ámbar 70-90%, rojo ≥90% (también si excedió y allowed=false).
 */
function BudgetMeter({ budget }: { budget: BudgetStatus }) {
  if (budget.budgetUsd == null) return null;
  const pct = Math.min(100, (budget.spentUsd / budget.budgetUsd) * 100);
  const tone = !budget.allowed || pct >= 90
    ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
    : pct >= 70
    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  return (
    <span
      className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 ${tone}`}
      title={`${budget.conversationCount} conversaciones este mes`}
    >
      <span className="font-medium">{fmtUsd(budget.spentUsd)}</span>
      <span className="opacity-70">/ {fmtUsd(budget.budgetUsd)}</span>
      <span className="opacity-60">({pct.toFixed(0)}%)</span>
    </span>
  );
}
