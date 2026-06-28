"use client";

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
          <div className="absolute inset-y-0 left-2 right-2 rounded-lg bg-hover" />
          <div className="absolute inset-y-1.5 left-2.5 w-[3px] rounded-full bg-violet-400" />
        </>
      )}
      <div
        className={cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium",
          "transition-colors duration-150 hover:bg-hover",
          isActive ? "text-strong" : "text-muted hover:text-body"
        )}
      >
        <span
          className={cn(
            "flex-shrink-0 transition-colors duration-150",
            isActive ? "text-violet-600 dark:text-violet-400" : "text-faint group-hover:text-muted"
          )}
        >
          {icon}
        </span>
        <span
          className={cn(
            "overflow-hidden whitespace-nowrap transition-all duration-200",
            collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
          )}
        >
          {label}
        </span>
      </div>
    </Link>
  );
}
