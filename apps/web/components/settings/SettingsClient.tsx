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
import { useTranslations } from "next-intl";
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
  icon: LucideIcon;
  /** "danger" → estiliza distinto en el sidebar. */
  variant?: "danger";
  /** Si retorna false, la tab se oculta (e.g. billing en self-host). */
  visible?: (ctx: { stripeEnabled: boolean }) => boolean;
}

/**
 * Stable tabs → URL hash sync for deep-links and browser back/forward.
 * Order reflects usage frequency (general/account at top, danger at bottom).
 */
const TABS: Tab[] = [
  { id: "general", icon: Building2 },
  { id: "account", icon: User },
  { id: "notifications", icon: Bell },
  { id: "providers", icon: Sparkles },
  {
    id: "billing",
    icon: CreditCard,
    visible: (ctx) => ctx.stripeEnabled || true, // always visible — shows "Self-hosted"
  },
  { id: "members", icon: UsersIcon },
  { id: "sessions", icon: Monitor },
  { id: "audit", icon: ScrollText },
  { id: "developers", icon: Code },
  { id: "danger", icon: AlertTriangle, variant: "danger" },
];

export function SettingsClient({ workspace, me, stripeEnabled, labels }: Props) {
  const t = useTranslations("pages.settings");
  const visibleTabs = useMemo(
    () => TABS.filter((tab) => (tab.visible ? tab.visible({ stripeEnabled }) : true)),
    [stripeEnabled]
  );

  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === "undefined") return "general";
    const hash = window.location.hash.replace("#", "");
    return visibleTabs.find((tab) => tab.id === hash)?.id ?? "general";
  });

  // Sync with URL hash → enables deep-links to /settings#providers.
  useEffect(() => {
    function onHash() {
      const hash = window.location.hash.replace("#", "");
      if (hash && visibleTabs.find((tab) => tab.id === hash)) {
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
        {t("loadError")}
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
        {/* Tab sidebar */}
        <nav aria-label={t("sidebarAria")} className="lg:sticky lg:top-4 lg:self-start">
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
                    <span>{t(`tabs.${tab.id}`)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Active tab content */}
        <div className="min-w-0 space-y-6">
          {activeTab === "general" && <GeneralSection workspace={workspace} />}
          {activeTab === "account" && <AccountSection me={me} />}
          {activeTab === "notifications" && <NotificationsSection />}
          {activeTab === "providers" && (
            <SettingsCard
              icon={<Sparkles size={16} />}
              title={t("sections.providersTitle")}
              description={t("sections.providersDescription")}
            >
              <AIProvidersSection />
            </SettingsCard>
          )}
          {activeTab === "billing" && (
            <SettingsCard
              icon={<CreditCard size={16} />}
              title={t("sections.billingTitle")}
              description={t("sections.billingDescription")}
            >
              <BillingSection />
            </SettingsCard>
          )}
          {activeTab === "members" && (
            <SettingsCard
              icon={<UsersIcon size={16} />}
              title={t("sections.membersTitle")}
              description={t("sections.membersDescription")}
            >
              <MembersSection />
            </SettingsCard>
          )}
          {activeTab === "sessions" && (
            <SettingsCard
              icon={<Monitor size={16} />}
              title={t("sections.sessionsTitle")}
              description={t("sections.sessionsDescription")}
            >
              <SessionsSection />
            </SettingsCard>
          )}
          {activeTab === "audit" && (
            <SettingsCard
              icon={<ScrollText size={16} />}
              title={t("sections.auditTitle")}
              description={t("sections.auditDescription")}
            >
              <AuditLogSection />
            </SettingsCard>
          )}
          {activeTab === "developers" && (
            <SettingsCard
              icon={<Code size={16} />}
              title={t("sections.developersTitle")}
              description={t("sections.developersDescription")}
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
