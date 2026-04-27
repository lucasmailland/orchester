"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Input } from "@heroui/react";
import { Search } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  area: string | null;
  active: boolean;
}

interface EmployeeTableProps {
  employees: Employee[];
  labels: {
    search: string;
    area: string;
    email: string;
    phone: string;
    active: string;
    inactive: string;
    empty: string;
    emptyCta: string;
  };
}

export function EmployeeTable({ employees, labels }: EmployeeTableProps) {
  const [query, setQuery] = useState("");

  const filtered = employees.filter((e) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <Input
        value={query}
        onValueChange={setQuery}
        placeholder={labels.search}
        startContent={<Search size={15} className="shrink-0 text-zinc-500" />}
        classNames={{ inputWrapper: "bg-zinc-900 border-white/[0.08] max-w-sm" }}
        size="sm"
      />

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">{labels.empty}</p>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="overflow-hidden rounded-xl border border-white/[0.07]"
        >
          {filtered.map((emp, idx) => (
            <motion.div
              key={emp.id}
              variants={staggerItem}
              className={cn(
                "flex items-center gap-4 px-4 py-3 bg-zinc-900/40 hover:bg-white/[0.03] transition-colors",
                idx < filtered.length - 1 && "border-b border-white/[0.05]"
              )}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-blue-600 text-[11px] font-bold text-white">
                {emp.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">{emp.name}</p>
                <p className="truncate text-xs text-zinc-500">{emp.email}</p>
              </div>
              <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                {emp.area && (
                  <span className="rounded-md border border-zinc-700/50 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
                    {emp.area}
                  </span>
                )}
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", emp.active ? "bg-emerald-400" : "bg-zinc-600")} />
                  <span className={cn("text-[11px] font-medium", emp.active ? "text-emerald-400" : "text-zinc-500")}>
                    {emp.active ? labels.active : labels.inactive}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
