"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface SidebarItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
}

export function SidebarItem({ href, icon, label, collapsed }: SidebarItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link href={href} className="relative block px-2">
      {isActive && (
        <motion.div
          layoutId="sidebar-active-indicator"
          className="absolute inset-0 rounded-lg bg-fichap-primary/10 dark:bg-fichap-primary/20"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
      <div
        className={cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
          "hover:bg-fichap-primary/5 dark:hover:bg-white/5",
          isActive
            ? "text-fichap-primary"
            : "text-default-600 hover:text-default-900 dark:text-default-400 dark:hover:text-default-100"
        )}
      >
        <span
          className={cn(
            "flex-shrink-0 transition-transform duration-150",
            isActive && "scale-110"
          )}
        >
          {icon}
        </span>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="overflow-hidden whitespace-nowrap"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </Link>
  );
}
