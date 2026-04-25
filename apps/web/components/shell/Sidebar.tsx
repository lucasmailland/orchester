"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Home,
  Users,
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

  const navItems = [
    { href: `/${locale}`, icon: <Home size={18} />, label: t("home") },
    { href: `/${locale}/teams`, icon: <Users size={18} />, label: t("teams") },
    { href: `/${locale}/agents`, icon: <Bot size={18} />, label: t("agents") },
    {
      href: `/${locale}/conversations`,
      icon: <MessageSquare size={18} />,
      label: t("conversations"),
    },
    {
      href: `/${locale}/employees`,
      icon: <Users size={18} />,
      label: t("employees"),
    },
    {
      href: `/${locale}/channels`,
      icon: <Radio size={18} />,
      label: t("channels"),
    },
    {
      href: `/${locale}/integrations`,
      icon: <Plug size={18} />,
      label: t("integrations"),
    },
    {
      href: `/${locale}/usage`,
      icon: <BarChart3 size={18} />,
      label: t("usage"),
    },
    {
      href: `/${locale}/settings`,
      icon: <Settings size={18} />,
      label: t("settings"),
    },
  ];

  return (
    <motion.aside
      variants={sidebarVariants}
      animate={collapsed ? "collapsed" : "expanded"}
      transition={{ duration: 0.25, ease: APPLE_EASE }}
      className={cn(
        "relative flex h-full flex-col",
        "border-r border-default-100 bg-background dark:border-white/5"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center overflow-hidden px-4">
        <motion.div
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 overflow-hidden"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-fichap-primary to-fichap-accent">
            <span className="text-xs font-bold text-white">O</span>
          </div>
          <AnimatePresenceWrapper show={!collapsed}>
            <span className="whitespace-nowrap text-base font-bold tracking-tight text-default-900 dark:text-default-100">
              Orchester
            </span>
          </AnimatePresenceWrapper>
        </motion.div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        <div className="flex flex-col gap-0.5">
          {navItems.map((item) => (
            <SidebarItem key={item.href} {...item} collapsed={collapsed} />
          ))}
        </div>
      </nav>

      {/* Collapse toggle */}
      <div className="shrink-0 border-t border-default-100 p-2 dark:border-white/5">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            "flex w-full items-center justify-center rounded-lg p-2",
            "text-default-400 transition-colors duration-150",
            "hover:bg-default-100 hover:text-default-700",
            "dark:hover:bg-white/5 dark:hover:text-default-300"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <motion.div
            animate={{ rotate: collapsed ? 180 : 0 }}
            transition={{ duration: 0.25, ease: APPLE_EASE }}
          >
            <ChevronLeft size={16} />
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
