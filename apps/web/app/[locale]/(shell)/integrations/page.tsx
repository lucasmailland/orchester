import { Database, FileText, Calendar, CreditCard, Boxes, Lock } from "lucide-react";

interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  Icon: typeof Database;
  available: boolean;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "google-workspace",
    name: "Google Workspace",
    description: "Calendar, Drive, Gmail, Docs — los agentes pueden consultar y actuar sobre tu Workspace.",
    Icon: Calendar,
    available: false,
  },
  {
    id: "notion",
    name: "Notion",
    description: "Que tus agentes lean tu base de conocimiento y creen páginas automáticamente.",
    Icon: FileText,
    available: false,
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Crear suscripciones, leer facturas y gestionar customers desde un agente.",
    Icon: CreditCard,
    available: false,
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Conectá una base externa de solo lectura para que los agentes consulten datos del negocio.",
    Icon: Database,
    available: false,
  },
  {
    id: "zapier",
    name: "Zapier / Make",
    description: "5000+ apps vía Zapier o Make a través de webhooks bidireccionales.",
    Icon: Boxes,
    available: false,
  },
];

export default function IntegrationsPage() {
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
        {INTEGRATIONS.map((i) => (
          <div
            key={i.id}
            className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4"
          >
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
                <i.Icon className="h-4 w-4" />
              </div>
              <div className="font-medium text-zinc-100">{i.name}</div>
              {!i.available && (
                <span className="ml-auto flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                  <Lock className="h-2.5 w-2.5" /> Próximamente
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-zinc-500">{i.description}</p>
            <button
              type="button"
              disabled={!i.available}
              className="mt-3 w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 py-2 text-xs text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {i.available ? "Conectar" : "Notificarme"}
            </button>
          </div>
        ))}
      </div>

      <p className="rounded-xl border border-white/[0.06] bg-zinc-900/30 p-4 text-xs text-zinc-500">
        💡 Por ahora podés usar el nodo <strong>HTTP</strong> en el Flow Builder para llamar
        cualquier API REST con auth Bearer/API key.
      </p>
    </div>
  );
}
