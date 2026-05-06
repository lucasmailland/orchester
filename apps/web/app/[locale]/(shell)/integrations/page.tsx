import { Database, FileText, Calendar, CreditCard, Boxes, Lock, MessageSquare, Send, ExternalLink } from "lucide-react";
import Link from "next/link";

interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  Icon: typeof Database;
  /** "Disponible" → muestra botón "Configurar" linkeado a /channels o /settings */
  status: "available" | "soon";
  href?: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "slack",
    name: "Slack",
    description: "DMs y menciones del bot atendidas por un agente. Setup en /channels con bot token + signing secret.",
    Icon: MessageSquare,
    status: "available",
    href: "/channels",
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Bot de Telegram que conversa con un agente. Setup en /channels con bot token; el webhook se autoconfigura.",
    Icon: Send,
    status: "available",
    href: "/channels",
  },
  {
    id: "google-workspace",
    name: "Google Workspace",
    description: "Calendar, Drive, Gmail, Docs — los agentes pueden consultar y actuar sobre tu Workspace.",
    Icon: Calendar,
    status: "soon",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Que tus agentes lean tu base de conocimiento y creen páginas automáticamente.",
    Icon: FileText,
    status: "soon",
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Crear suscripciones, leer facturas y gestionar customers desde un agente.",
    Icon: CreditCard,
    status: "soon",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Conectá una base externa de solo lectura para que los agentes consulten datos del negocio.",
    Icon: Database,
    status: "soon",
  },
  {
    id: "zapier",
    name: "Zapier / Make",
    description: "5000+ apps vía Zapier o Make a través de webhooks bidireccionales.",
    Icon: Boxes,
    status: "soon",
  },
];

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const localeHref = (path: string) => `/${locale}${path}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
          Integraciones
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Conectá Orchester con las herramientas que ya usás.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((i) => {
          const isAvailable = i.status === "available";
          const card = (
            <div
              className={
                isAvailable
                  ? "h-full rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 transition-colors hover:bg-emerald-500/[0.06]"
                  : "h-full rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4"
              }
            >
              <div className="mb-3 flex items-center gap-2.5">
                <div
                  className={
                    isAvailable
                      ? "flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"
                      : "flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400"
                  }
                >
                  <i.Icon className="h-4 w-4" />
                </div>
                <div className="font-medium text-zinc-100">{i.name}</div>
                {isAvailable ? (
                  <span className="ml-auto flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">
                    Disponible
                  </span>
                ) : (
                  <span className="ml-auto flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                    <Lock className="h-2.5 w-2.5" /> Próximamente
                  </span>
                )}
              </div>
              <p className="text-xs leading-relaxed text-zinc-500">{i.description}</p>
              <div
                className={
                  isAvailable
                    ? "mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2 text-xs font-medium text-emerald-300"
                    : "mt-3 flex items-center justify-center rounded-lg border border-white/[0.08] bg-zinc-800/40 py-2 text-xs text-zinc-500"
                }
              >
                {isAvailable ? (
                  <>
                    Configurar <ExternalLink className="h-3 w-3" />
                  </>
                ) : (
                  "Notificarme"
                )}
              </div>
            </div>
          );
          return isAvailable && i.href ? (
            <Link key={i.id} href={localeHref(i.href)} aria-label={`Configurar ${i.name}`}>
              {card}
            </Link>
          ) : (
            <div key={i.id}>{card}</div>
          );
        })}
      </div>

      <p className="rounded-xl border border-white/[0.06] bg-zinc-900/30 p-4 text-xs text-zinc-500">
        💡 Por ahora podés usar el nodo <strong>HTTP</strong> en el Flow Builder para llamar
        cualquier API REST con auth Bearer/API key.
      </p>
    </div>
  );
}
