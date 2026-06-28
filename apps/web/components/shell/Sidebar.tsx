"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import {
  Home,
  Users,
  Layers,
  Network,
  Bot,
  MessageSquare,
  Plug,
  Radio,
  Settings,
  ChevronLeft,
  Workflow,
  BookOpen,
  Brain,
} from "lucide-react";
import { SidebarItem } from "./SidebarItem";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";

interface SidebarProps {
  locale: string;
}

export function Sidebar({ locale }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const t = useTranslations("nav");
  const params = useParams<{ workspaceSlug?: string }>();
  const ws = params?.workspaceSlug ?? "";
  const base = `/${locale}/${ws}`;

  const workspaceNav = [
    { href: `${base}`, icon: <Home size={16} />, label: t("home") },
    {
      href: `${base}/conversations`,
      icon: <MessageSquare size={16} />,
      label: t("conversations"),
    },
  ];

  const buildNav = [
    { href: `${base}/org`, icon: <Network size={16} />, label: t("org") },
    { href: `${base}/teams`, icon: <Layers size={16} />, label: t("teams") },
    { href: `${base}/agents`, icon: <Bot size={16} />, label: t("agents") },
    { href: `${base}/flows`, icon: <Workflow size={16} />, label: t("flows") },
  ];

  const dataNav = [
    { href: `${base}/employees`, icon: <Users size={16} />, label: t("employees") },
    { href: `${base}/knowledge`, icon: <BookOpen size={16} />, label: t("knowledge") },
    { href: `${base}/brain`, icon: <Brain size={16} />, label: t("brain") },
  ];

  const systemNav = [
    { href: `${base}/channels`, icon: <Radio size={16} />, label: t("channels") },
    { href: `${base}/integrations`, icon: <Plug size={16} />, label: t("integrations") },
    { href: `${base}/settings`, icon: <Settings size={16} />, label: t("settings") },
  ];

  const groups: Array<{ label: string; items: typeof workspaceNav }> = [
    { label: t("group_workspace"), items: workspaceNav },
    { label: t("group_automation"), items: buildNav },
    { label: t("group_data"), items: dataNav },
    { label: t("group_system"), items: systemNav },
  ];

  return (
    <aside
      style={{
        width: collapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)",
        transition: "width 0.25s cubic-bezier(0.25,0.46,0.45,0.94)",
      }}
      className={cn("relative flex h-full flex-col", "border-r border-line bg-surface")}
    >
      {/* Header: workspace switcher when expanded, brand mark when collapsed */}
      <div className="flex h-14 shrink-0 items-center overflow-hidden border-b border-line px-2">
        {collapsed ? (
          <div className="relative mx-auto flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500 via-blue-500 to-violet-700" />
            <span className="relative text-[11px] font-extrabold text-white">O</span>
          </div>
        ) : (
          <div className="flex-1 px-2">
            <WorkspaceSwitcher />
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3">
        {groups.map((group, idx) => (
          <div key={group.label}>
            {idx > 0 && <div className="my-3 mx-3 border-t border-line" />}
            <div
              className={cn(
                "mb-1.5 overflow-hidden transition-all duration-200",
                collapsed ? "max-h-0 opacity-0" : "max-h-10 opacity-100"
              )}
            >
              <div className="px-4">
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-faint">
                  {group.label}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <SidebarItem key={item.href} {...item} collapsed={collapsed} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="shrink-0 border-t border-line p-2">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            "flex w-full items-center justify-center rounded-lg p-2",
            "text-faint transition-colors duration-150",
            "hover:bg-white/[0.05] hover:text-body"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft
            size={14}
            style={{
              transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.25s cubic-bezier(0.25,0.46,0.45,0.94)",
            }}
          />
        </button>
      </div>
    </aside>
  );
}
