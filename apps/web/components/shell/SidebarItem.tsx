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
  const isActive = pathname === href || (href.includes("/", 1) && pathname.startsWith(href + "/"));

  return (
    <Link href={href} className="relative block px-2">
      {isActive && (
        <>
          <motion.div
            layoutId="sidebar-active-bg"
            className="absolute inset-y-0 left-2 right-2 rounded-lg bg-white/[0.07]"
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          />
          <motion.div
            layoutId="sidebar-active-bar"
            className="absolute inset-y-1.5 left-2.5 w-[3px] rounded-full bg-violet-400"
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          />
        </>
      )}
      <div
        className={cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium",
          "transition-colors duration-150 hover:bg-white/[0.04]",
          isActive ? "text-white" : "text-zinc-500 hover:text-zinc-200"
        )}
      >
        <span
          className={cn(
            "flex-shrink-0 transition-colors duration-150",
            isActive ? "text-violet-400" : "text-zinc-600 group-hover:text-zinc-400"
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
