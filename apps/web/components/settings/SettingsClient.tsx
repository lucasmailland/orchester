"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  User,
  Bell,
  Sparkles,
  CreditCard,
  Users as UsersIcon,
  Code,
  AlertTriangle,
  Monitor,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GeneralSection } from "./GeneralSection";
import { AccountSection } from "./AccountSection";
import { NotificationsSection } from "./NotificationsSection";
import { AIProvidersSection } from "./AIProvidersSection";
import { BillingSection } from "./BillingSection";
import { MembersSection } from "./MembersSection";
import { DevelopersSection } from "./DevelopersSection";
import { DangerZoneSection } from "./DangerZoneSection";
import { SessionsSection } from "./SessionsSection";
import { AuditLogSection } from "./AuditLogSection";
import { SettingsCard } from "./_layout";

interface WorkspaceCtx {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  role: string;
}

interface MeCtx {
  id: string;
  name: string;
  email: string;
  preferredLocale: string;
  preferredTheme: string;
  twoFactorEnabled?: boolean;
}

interface Props {
  workspace: WorkspaceCtx | null;
  me: MeCtx | null;
  stripeEnabled: boolean;
  labels: { title: string; subtitle: string };
}

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
  /** "danger" → estiliza distinto en el sidebar. */
  variant?: "danger";
  /** Si retorna false, la tab se oculta (e.g. billing en self-host). */
  visible?: (ctx: { stripeEnabled: boolean }) => boolean;
}

/**
 * Tabs estables → URL hash sincronizada para deep-link y back/forward del browser.
 * El orden refleja la frecuencia de uso (general/cuenta arriba, danger abajo).
 */
const TABS: Tab[] = [
  { id: "general", label: "General", icon: Building2 },
  { id: "account", label: "Mi cuenta", icon: User },
  { id: "notifications", label: "Notificaciones", icon: Bell },
  { id: "providers", label: "Proveedores IA", icon: Sparkles },
  {
    id: "billing",
    label: "Plan y uso",
    icon: CreditCard,
    visible: (ctx) => ctx.stripeEnabled || true, // siempre visible — muestra "Self-hosted"
  },
  { id: "members", label: "Equipo", icon: UsersIcon },
  { id: "sessions", label: "Sesiones", icon: Monitor },
  { id: "audit", label: "Audit log", icon: ScrollText },
  { id: "developers", label: "Desarrolladores", icon: Code },
  { id: "danger", label: "Zona de peligro", icon: AlertTriangle, variant: "danger" },
];

export function SettingsClient({ workspace, me, stripeEnabled, labels }: Props) {
  const visibleTabs = useMemo(
    () => TABS.filter((t) => (t.visible ? t.visible({ stripeEnabled }) : true)),
    [stripeEnabled]
  );

  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === "undefined") return "general";
    const hash = window.location.hash.replace("#", "");
    return visibleTabs.find((t) => t.id === hash)?.id ?? "general";
  });

  // Sincroniza con el hash del URL → permite deep-links a /settings#providers.
  useEffect(() => {
    function onHash() {
      const hash = window.location.hash.replace("#", "");
      if (hash && visibleTabs.find((t) => t.id === hash)) {
        setActiveTab(hash);
      }
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [visibleTabs]);

  function selectTab(id: string) {
    setActiveTab(id);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
    }
  }

  if (!workspace || !me) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted">
        No se pudo cargar el workspace.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-strong">
          {labels.title}
        </h1>
        <p className="mt-1 text-sm text-muted">{labels.subtitle}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Sidebar de tabs */}
        <nav
          aria-label="Secciones de configuración"
          className="lg:sticky lg:top-4 lg:self-start"
        >
          <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:gap-0.5 lg:pb-0">
            {visibleTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const isDanger = tab.variant === "danger";
              return (
                <li key={tab.id}>
                  <button
                    type="button"
                    onClick={() => selectTab(tab.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                      isActive
                        ? isDanger
                          ? "bg-red-500/10 text-red-700 dark:text-red-300"
                          : "bg-violet-500/15 text-violet-700 dark:text-violet-200"
                        : isDanger
                        ? "text-red-400/80 hover:bg-red-500/5 hover:text-red-700 dark:hover:text-red-300"
                        : "text-muted hover:bg-hover hover:text-body"
                    )}
                  >
                    <tab.icon size={14} aria-hidden="true" />
                    <span>{tab.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Contenido de la tab activa */}
        <div className="min-w-0 space-y-6">
          {activeTab === "general" && <GeneralSection workspace={workspace} />}
          {activeTab === "account" && <AccountSection me={me} />}
          {activeTab === "notifications" && <NotificationsSection />}
          {activeTab === "providers" && (
            <SettingsCard
              icon={<Sparkles size={16} />}
              title="Proveedores de IA"
              description="Conectá Anthropic, OpenAI, Google AI o Azure. Los modelos disponibles aparecen en el editor de agentes y los flujos."
            >
              <AIProvidersSection />
            </SettingsCard>
          )}
          {activeTab === "billing" && (
            <SettingsCard
              icon={<CreditCard size={16} />}
              title="Plan y uso"
              description="Tu plan, uso del mes y límites."
            >
              <BillingSection />
            </SettingsCard>
          )}
          {activeTab === "members" && (
            <SettingsCard
              icon={<UsersIcon size={16} />}
              title="Equipo"
              description="Miembros del workspace e invitaciones pendientes."
            >
              <MembersSection />
            </SettingsCard>
          )}
          {activeTab === "sessions" && (
            <SettingsCard
              icon={<Monitor size={16} />}
              title="Sesiones activas"
              description="Devices conectados a tu cuenta. Cerralos remotamente si sospechás compromise."
            >
              <SessionsSection />
            </SettingsCard>
          )}
          {activeTab === "audit" && (
            <SettingsCard
              icon={<ScrollText size={16} />}
              title="Audit log"
              description="Cada mutación crítica del workspace queda registrada acá. Read-only."
            >
              <AuditLogSection />
            </SettingsCard>
          )}
          {activeTab === "developers" && (
            <SettingsCard
              icon={<Code size={16} />}
              title="Desarrolladores"
              description="API keys, webhooks salientes, y referencia de la API pública."
            >
              <DevelopersSection />
            </SettingsCard>
          )}
          {activeTab === "danger" && <DangerZoneSection workspace={workspace} />}
        </div>
      </div>
    </div>
  );
}
