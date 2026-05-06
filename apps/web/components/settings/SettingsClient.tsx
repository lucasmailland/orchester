"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Building2, Bell, Globe, Users, AlertTriangle, Check, Sparkles, Code, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIProvidersSection } from "./AIProvidersSection";
import { DevelopersSection } from "./DevelopersSection";
import { MembersSection } from "./MembersSection";
import { BillingSection } from "./BillingSection";
import { toast } from "sonner";

interface SettingsLabels {
  title: string;
  subtitle: string;
  workspace: string;
  workspaceName: string;
  workspaceSlug: string;
  workspaceNamePlaceholder: string;
  save: string;
  saved: string;
  danger: string;
  deleteWorkspace: string;
  deleteWarning: string;
  apiKeys: string;
  apiKeysDescription: string;
  noApiKeys: string;
  addApiKey: string;
  notifications: string;
  notificationsDescription: string;
  locale: string;
  localeDescription: string;
  team: string;
  teamDescription: string;
}

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
}

interface SettingsClientProps {
  workspace: WorkspaceInfo | null;
  labels: SettingsLabels;
}

const inputClass = cn(
  "w-full rounded-xl border border-white/[0.08] bg-zinc-800/60 px-3.5 py-2.5",
  "text-sm text-zinc-100 placeholder-zinc-600",
  "outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30",
  "transition-all"
);

const SECTION_ICON_CLASS = "flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05] text-zinc-400";

function SectionCard({ icon, title, description, children }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-6"
    >
      <div className="mb-5 flex items-start gap-3">
        <div className={SECTION_ICON_CLASS}>{icon}</div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <p className="text-xs text-zinc-500">{description}</p>
        </div>
      </div>
      {children}
    </motion.div>
  );
}

const LOCALES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "pt-BR", label: "Português (BR)" },
];

const NOTIFICATION_SETTINGS = [
  { id: "conv_escalated", label: "Conversation escalated", description: "When an agent escalates a conversation", defaultOn: true },
  { id: "agent_down", label: "Agent goes offline", description: "When an active agent becomes unavailable", defaultOn: true },
  { id: "weekly_report", label: "Weekly usage report", description: "Summary of token consumption every Monday", defaultOn: false },
  { id: "new_member", label: "New workspace member", description: "When someone joins your workspace", defaultOn: true },
];

export function SettingsClient({ workspace, labels }: SettingsClientProps) {
  const router = useRouter();
  const [wsName, setWsName] = useState(workspace?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [selectedLocale, setSelectedLocale] = useState("en");
  const [notifications, setNotifications] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIFICATION_SETTINGS.map(n => [n.id, n.defaultOn]))
  );
  async function handleSaveWorkspace(e: { preventDefault: () => void }) {
    e.preventDefault();
    setSaving(true);
    setSavedOk(false);
    try {
      const res = await fetch(`/api/workspaces/${workspace?.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: wsName }),
      });
      if (res.ok) {
        setSavedOk(true);
        router.refresh();
        setTimeout(() => setSavedOk(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  function toggleNotification(id: string) {
    setNotifications(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">{labels.title}</h1>
        <p className="mt-1 text-sm text-zinc-500">{labels.subtitle}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Workspace Settings */}
        <SectionCard
          icon={<Building2 size={16} />}
          title={labels.workspace}
          description="Basic workspace information"
        >
          <form onSubmit={handleSaveWorkspace} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="ws-name" className="text-xs font-medium text-zinc-400">
                {labels.workspaceName}
              </label>
              <input
                id="ws-name"
                name="workspace-name"
                value={wsName}
                onChange={e => setWsName(e.target.value)}
                placeholder={labels.workspaceNamePlaceholder}
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ws-slug" className="text-xs font-medium text-zinc-400">
                {labels.workspaceSlug}
              </label>
              <input
                id="ws-slug"
                name="workspace-slug"
                value={workspace?.slug ?? ""}
                readOnly
                className={cn(inputClass, "cursor-not-allowed opacity-50")}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-opacity disabled:opacity-60"
              >
                {savedOk ? (
                  <><Check size={14} />{labels.saved}</>
                ) : saving ? "…" : labels.save}
              </button>
            </div>
          </form>
        </SectionCard>

        {/* Language */}
        <SectionCard
          icon={<Globe size={16} />}
          title={labels.locale}
          description={labels.localeDescription}
        >
          <div className="space-y-2">
            {LOCALES.map(l => (
              <button
                key={l.value}
                onClick={() => setSelectedLocale(l.value)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-sm transition-all",
                  selectedLocale === l.value
                    ? "border-violet-500/40 bg-violet-500/10 text-zinc-100"
                    : "border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:border-white/10 hover:bg-white/[0.04]"
                )}
              >
                <span>{l.label}</span>
                {selectedLocale === l.value && (
                  <span className="h-2 w-2 rounded-full bg-violet-400" />
                )}
              </button>
            ))}
          </div>
        </SectionCard>

        {/* Notifications */}
        <SectionCard
          icon={<Bell size={16} />}
          title={labels.notifications}
          description={labels.notificationsDescription}
        >
          <div className="space-y-3">
            {NOTIFICATION_SETTINGS.map(n => (
              <div key={n.id} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200">{n.label}</p>
                  <p className="text-xs text-zinc-600">{n.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={notifications[n.id] ?? false}
                  aria-label={n.label}
                  onClick={() => toggleNotification(n.id)}
                  className={cn(
                    "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
                    notifications[n.id] ? "bg-violet-500" : "bg-zinc-700"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
                      notifications[n.id] ? "translate-x-4" : "translate-x-0.5"
                    )}
                  />
                </button>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* AI Providers */}
        <SectionCard
          icon={<Sparkles size={16} />}
          title="Proveedores de IA"
          description="Conectá tus claves de Anthropic, OpenAI, Google AI o Azure. Los modelos disponibles aparecen en el editor de agentes y en los flujos."
        >
          <AIProvidersSection />
        </SectionCard>

        {/* Billing */}
        <SectionCard
          icon={<CreditCard size={16} />}
          title="Plan y consumo"
          description="Tu plan, uso del mes y límites."
        >
          <BillingSection />
        </SectionCard>

        {/* Members */}
        <SectionCard
          icon={<Users size={16} />}
          title="Miembros e invitaciones"
          description="Invitá personas a tu workspace con un rol específico."
        >
          <MembersSection />
        </SectionCard>

        {/* Developers */}
        <SectionCard
          icon={<Code size={16} />}
          title="Desarrolladores"
          description="API keys, webhooks salientes y eventos."
        >
          <DevelopersSection />
        </SectionCard>

      </div>

      {/* Danger Zone */}
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
            <AlertTriangle size={16} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-red-400">{labels.danger}</h3>
            <p className="text-xs text-zinc-600">{labels.deleteWarning}</p>
          </div>
        </div>
        <button
          onClick={() => toast.error("Esta acción no está disponible en modo demo")}
          className="rounded-xl border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
        >
          {labels.deleteWorkspace}
        </button>
      </div>
    </div>
  );
}
