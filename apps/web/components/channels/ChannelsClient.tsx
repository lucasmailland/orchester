"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, MessageCircle, Send, MessagesSquare, Mail, Webhook, Plus, Copy, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { NoProviderBanner } from "@/components/common/NoProviderBanner";

type ChannelType = "widget" | "telegram" | "slack" | "whatsapp" | "email" | "api" | "web";

interface Channel {
  id: string;
  name: string;
  type: string;
  status: string;
  agentId: string | null;
  secret: string | null;
  hasCredentials: boolean;
  config: Record<string, unknown>;
}
interface Agent {
  id: string;
  name: string;
  status: string;
}

const TYPE_META: Record<ChannelType, { label: string; Icon: typeof Globe; description: string; supported: boolean }> = {
  widget: {
    label: "Web Widget",
    Icon: Globe,
    description: "Embed un chat en cualquier sitio con un script.",
    supported: true,
  },
  web: {
    label: "Web Widget",
    Icon: Globe,
    description: "Alias de Widget.",
    supported: true,
  },
  telegram: {
    label: "Telegram",
    Icon: Send,
    description: "Bot de Telegram con respuesta automática del agente.",
    supported: true,
  },
  whatsapp: {
    label: "WhatsApp",
    Icon: MessageCircle,
    description: "Conectá vía Twilio o Meta Cloud API. (Adapter listo, requiere cuenta).",
    supported: false,
  },
  slack: {
    label: "Slack",
    Icon: MessagesSquare,
    description: "Slash commands y DMs. (Requiere Slack app).",
    supported: false,
  },
  email: {
    label: "Email",
    Icon: Mail,
    description: "Inbox virtual con Resend / Postmark.",
    supported: false,
  },
  api: {
    label: "API",
    Icon: Webhook,
    description: "Endpoint público con secret para disparar agentes desde código.",
    supported: true,
  },
};

export function ChannelsClient({ channels, agents }: { channels: Channel[]; agents: Agent[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState<ChannelType | null>(null);
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState<string>(agents[0]?.id ?? "");

  async function create(type: ChannelType) {
    if (!name.trim()) return toast.error("Nombre requerido");
    if (!agentId) return toast.error("Asigná un agente");
    const r = await fetch("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, type, agentId }),
    });
    if (r.ok) {
      toast.success("Canal creado");
      setCreating(null);
      setName("");
      router.refresh();
    } else {
      toast.error("No se pudo crear");
    }
  }

  return (
    <div className="space-y-6">
      <NoProviderBanner />

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">Canales</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Conectá tus agentes a los canales donde están tus clientes y empleados.
        </p>
      </div>

      {/* Available types to create */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(TYPE_META) as ChannelType[])
          .filter((t) => t !== "web")
          .map((t) => {
            const meta = TYPE_META[t];
            return (
              <div
                key={t}
                className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4"
              >
                <div className="mb-3 flex items-center gap-2.5">
                  <div
                    className={
                      meta.supported
                        ? "flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400"
                        : "flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-800 text-zinc-500"
                    }
                  >
                    <meta.Icon className="h-4 w-4" />
                  </div>
                  <div className="font-medium text-zinc-100">{meta.label}</div>
                  {!meta.supported && (
                    <span className="ml-auto rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                      Beta
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-zinc-500">{meta.description}</p>
                <button
                  type="button"
                  disabled={!meta.supported}
                  onClick={() => setCreating(t)}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-zinc-800/40 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> Conectar {meta.label}
                </button>
              </div>
            );
          })}
      </div>

      {creating && (
        <div className="space-y-2 rounded-2xl border border-violet-500/30 bg-zinc-900/40 p-4">
          <div className="text-sm font-medium text-zinc-100">
            Nuevo canal · {TYPE_META[creating].label}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del canal (e.g. 'Soporte WhatsApp')"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/60"
          />
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/60"
          >
            <option value="">— Elegí un agente —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {a.status === "active" ? "" : `(${a.status})`}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => create(creating)}
              className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs text-white hover:bg-violet-400"
            >
              Crear
            </button>
            <button
              type="button"
              onClick={() => setCreating(null)}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {channels.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">Canales conectados</h2>
          <div className="space-y-2">
            {channels.map((c) => (
              <ConnectedChannelRow key={c.id} channel={c} agents={agents} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectedChannelRow({
  channel,
  agents,
}: {
  channel: Channel;
  agents: Agent[];
}) {
  const router = useRouter();
  const meta = TYPE_META[channel.type as ChannelType] ?? TYPE_META.api;
  const [expanded, setExpanded] = useState(false);
  const [credInput, setCredInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [agentId, setAgentId] = useState(channel.agentId ?? "");
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success("Copiado");
    setTimeout(() => setCopied(null), 1500);
  }

  async function saveCreds() {
    if (channel.type === "telegram" && !credInput.trim()) {
      return toast.error("Pegá el bot token");
    }
    setSaving(true);
    const credentials =
      channel.type === "telegram"
        ? { botToken: credInput.trim() }
        : { token: credInput.trim() };
    const r = await fetch(`/api/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentials }),
    });
    setSaving(false);
    const j = await r.json();
    if (r.ok) {
      if (j.error) toast.error(j.error);
      else if (j.webhookSet) toast.success(`Webhook configurado para @${j.botUsername}`);
      else toast.success("Credenciales guardadas");
      setCredInput("");
      router.refresh();
    } else {
      toast.error("No se pudo guardar");
    }
  }

  async function toggleStatus() {
    const next = channel.status === "active" ? "inactive" : "active";
    const r = await fetch(`/api/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (r.ok) {
      toast.success(next === "active" ? "Canal activado" : "Canal pausado");
      router.refresh();
    }
  }

  async function updateAgent(id: string) {
    setAgentId(id);
    await fetch(`/api/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: id }),
    });
    router.refresh();
  }

  async function remove() {
    if (!confirm("¿Eliminar este canal?")) return;
    await fetch(`/api/channels/${channel.id}`, { method: "DELETE" });
    toast.success("Eliminado");
    router.refresh();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embedSnippet = `<script src="${origin}/api/embed?c=${channel.id}" async></script>`;
  const telegramWebhookUrl = channel.secret
    ? `${origin}/api/channels/telegram/webhook/${channel.secret}`
    : "";
  const apiTriggerUrl = channel.secret ? `${origin}/api/widget/${channel.id}/messages` : "";

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400">
          <meta.Icon className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-zinc-100">{channel.name}</div>
          <div className="text-[11px] text-zinc-500">
            {meta.label} ·{" "}
            <span
              className={
                channel.status === "active" ? "text-emerald-400" : "text-amber-400"
              }
            >
              {channel.status}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleStatus}
          className="rounded-lg border border-white/[0.08] px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/5"
        >
          {channel.status === "active" ? "Pausar" : "Activar"}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="rounded-lg border border-white/[0.08] px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/5"
        >
          {expanded ? "Cerrar" : "Configurar"}
        </button>
        <button
          type="button"
          onClick={remove}
          className="text-zinc-500 hover:text-red-400"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4 text-xs">
          <div>
            <label className="block text-zinc-500">Agente</label>
            <select
              value={agentId}
              onChange={(e) => updateAgent(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
            >
              <option value="">— Sin agente —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {channel.type === "widget" && (
            <div>
              <label className="block text-zinc-500">Snippet de instalación</label>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/40 p-2">
                <pre className="flex-1 overflow-x-auto font-mono text-[11px] text-zinc-300">
                  {embedSnippet}
                </pre>
                <button
                  type="button"
                  onClick={() => copy(embedSnippet, "embed")}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  {copied === "embed" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-zinc-600">
                Pegá este script antes de <code>&lt;/body&gt;</code> en cualquier página HTML.
              </p>
            </div>
          )}

          {channel.type === "telegram" && (
            <>
              <div>
                <label className="block text-zinc-500">Bot Token (@BotFather)</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="password"
                    value={credInput}
                    onChange={(e) => setCredInput(e.target.value)}
                    placeholder={channel.hasCredentials ? "•••••••• (ya configurado, pegá uno nuevo para reemplazar)" : "123456:ABC-DEF…"}
                    className="flex-1 rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-violet-500/60"
                  />
                  <button
                    type="button"
                    onClick={saveCreds}
                    disabled={saving || !credInput.trim()}
                    className="flex items-center gap-1 rounded-lg bg-violet-500 px-3 py-1.5 text-xs text-white hover:bg-violet-400 disabled:opacity-40"
                  >
                    {saving && <Loader2 className="h-3 w-3 animate-spin" />} Guardar
                  </button>
                </div>
              </div>
              {channel.hasCredentials && (
                <div>
                  <label className="block text-zinc-500">Webhook URL (auto-configurado)</label>
                  <div className="mt-1 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/40 p-2">
                    <pre className="flex-1 overflow-x-auto font-mono text-[10px] text-zinc-300">
                      {telegramWebhookUrl}
                    </pre>
                    <button
                      type="button"
                      onClick={() => copy(telegramWebhookUrl, "webhook")}
                      className="text-zinc-500 hover:text-zinc-200"
                    >
                      {copied === "webhook" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {channel.type === "api" && (
            <div>
              <label className="block text-zinc-500">Endpoint público</label>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/40 p-2">
                <pre className="flex-1 overflow-x-auto font-mono text-[10px] text-zinc-300">
                  POST {apiTriggerUrl}
                </pre>
                <button
                  type="button"
                  onClick={() => copy(apiTriggerUrl, "api")}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  {copied === "api" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-zinc-600">
                Body: <code>{`{ visitorId: string, text: string }`}</code>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
