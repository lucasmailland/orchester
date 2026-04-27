"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Home,
  Users,
  Layers,
  Network,
  Bot,
  MessageSquare,
  Plug,
  Radio,
  BarChart3,
  Settings,
  ChevronLeft,
} from "lucide-react";
import { SidebarItem } from "./SidebarItem";
import { sidebarVariants, APPLE_EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface SidebarProps {
  locale: string;
}

export function Sidebar({ locale }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const t = useTranslations("nav");

  const mainNav = [
    { href: `/${locale}`, icon: <Home size={16} />, label: t("home") },
    { href: `/${locale}/teams`, icon: <Layers size={16} />, label: t("teams") },
    { href: `/${locale}/org`, icon: <Network size={16} />, label: t("org") },
    { href: `/${locale}/agents`, icon: <Bot size={16} />, label: t("agents") },
    { href: `/${locale}/conversations`, icon: <MessageSquare size={16} />, label: t("conversations") },
    { href: `/${locale}/employees`, icon: <Users size={16} />, label: t("employees") },
  ];

  const systemNav = [
    { href: `/${locale}/channels`, icon: <Radio size={16} />, label: t("channels") },
    { href: `/${locale}/integrations`, icon: <Plug size={16} />, label: t("integrations") },
    { href: `/${locale}/usage`, icon: <BarChart3 size={16} />, label: t("usage") },
    { href: `/${locale}/settings`, icon: <Settings size={16} />, label: t("settings") },
  ];

  return (
    <motion.aside
      variants={sidebarVariants}
      animate={collapsed ? "collapsed" : "expanded"}
      transition={{ duration: 0.25, ease: APPLE_EASE }}
      className={cn(
        "relative flex h-full flex-col",
        "border-r border-white/[0.06] bg-zinc-950"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center overflow-hidden border-b border-white/[0.06] px-4">
        <motion.div className="flex items-center gap-3 overflow-hidden">
          <div className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500 via-blue-500 to-violet-700" />
            <span className="relative text-[11px] font-extrabold text-white">O</span>
          </div>
          <AnimatePresenceWrapper show={!collapsed}>
            <div className="flex flex-col gap-px leading-none">
              <span className="whitespace-nowrap font-display text-sm font-bold tracking-tight text-white">
                Orchester
              </span>
              <span className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                AI Platform
              </span>
            </div>
          </AnimatePresenceWrapper>
        </motion.div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3">
        {/* Main section label */}
        <AnimatePresenceWrapper show={!collapsed}>
          <div className="mb-1.5 px-4">
            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-600">
              Main
            </span>
          </div>
        </AnimatePresenceWrapper>

        <div className="flex flex-col gap-0.5">
          {mainNav.map((item) => (
            <SidebarItem key={item.href} {...item} collapsed={collapsed} />
          ))}
        </div>

        <div className="my-3 mx-3 border-t border-white/[0.06]" />

        {/* System section label */}
        <AnimatePresenceWrapper show={!collapsed}>
          <div className="mb-1.5 px-4">
            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-600">
              System
            </span>
          </div>
        </AnimatePresenceWrapper>

        <div className="flex flex-col gap-0.5">
          {systemNav.map((item) => (
            <SidebarItem key={item.href} {...item} collapsed={collapsed} />
          ))}
        </div>
      </nav>

      {/* Collapse toggle */}
      <div className="shrink-0 border-t border-white/[0.06] p-2">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            "flex w-full items-center justify-center rounded-lg p-2",
            "text-zinc-600 transition-colors duration-150",
            "hover:bg-white/[0.05] hover:text-zinc-300"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <motion.div
            animate={{ rotate: collapsed ? 180 : 0 }}
            transition={{ duration: 0.25, ease: APPLE_EASE }}
          >
            <ChevronLeft size={14} />
          </motion.div>
        </button>
      </div>
    </motion.aside>
  );
}

function AnimatePresenceWrapper({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: "auto" }}
          exit={{ opacity: 0, width: 0 }}
          transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
