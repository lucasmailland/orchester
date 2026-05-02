import { Globe, MessageCircle, Send, MessagesSquare, Mail, Webhook, Lock } from "lucide-react";

interface ChannelDef {
  id: string;
  name: string;
  description: string;
  Icon: typeof Globe;
  available: boolean;
  category: "web" | "messaging" | "team" | "email" | "api";
}

const CHANNELS: ChannelDef[] = [
  {
    id: "web",
    name: "Web Widget",
    description: "Embed un chat en cualquier sitio con un script.",
    Icon: Globe,
    available: false,
    category: "web",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Conectá un número de WhatsApp Business vía Twilio o Meta Cloud API.",
    Icon: MessageCircle,
    available: false,
    category: "messaging",
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Bot de Telegram con respuesta automática del agente.",
    Icon: Send,
    available: false,
    category: "messaging",
  },
  {
    id: "slack",
    name: "MessagesSquare",
    description: "Slash commands, mentions y DMs en tu workspace.",
    Icon: MessagesSquare,
    available: false,
    category: "team",
  },
  {
    id: "email",
    name: "Email",
    description: "Inbox virtual que rutea correos a tus agentes.",
    Icon: Mail,
    available: false,
    category: "email",
  },
  {
    id: "webhook",
    name: "Webhook",
    description: "Endpoint público con secret HMAC para disparar agentes/flujos.",
    Icon: Webhook,
    available: false,
    category: "api",
  },
];

export default function ChannelsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">Canales</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Conectá tus agentes a los canales donde están tus clientes y empleados.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {CHANNELS.map((c) => (
          <div
            key={c.id}
            className="relative rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4"
          >
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400">
                <c.Icon className="h-4 w-4" />
              </div>
              <div className="font-medium text-zinc-100">{c.name}</div>
              {!c.available && (
                <span className="ml-auto flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                  <Lock className="h-2.5 w-2.5" /> Próximamente
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-zinc-500">{c.description}</p>
            <button
              type="button"
              disabled={!c.available}
              className="mt-3 w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 py-2 text-xs text-zinc-400 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {c.available ? "Conectar" : "Notificarme cuando esté listo"}
            </button>
          </div>
        ))}
      </div>

      <p className="rounded-xl border border-white/[0.06] bg-zinc-900/30 p-4 text-xs text-zinc-500">
        💡 Los canales están en la <strong>Fase 4</strong> del roadmap. Mientras tanto, podés usar{" "}
        <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
          /api/agents/[id]/test-chat
        </code>{" "}
        directamente o exportar conversaciones de prueba.
      </p>
    </div>
  );
}
