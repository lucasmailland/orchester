"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Input, Chip } from "@heroui/react";
import { Search } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";

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
        startContent={<Search size={15} className="shrink-0 text-default-400" />}
        classNames={{ inputWrapper: "bg-default-100 dark:bg-default-50/10 max-w-sm" }}
        size="sm"
      />

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-default-400">{labels.empty}</p>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="overflow-hidden rounded-xl border border-default-100 dark:border-white/5"
        >
          {filtered.map((emp, idx) => (
            <motion.div
              key={emp.id}
              variants={staggerItem}
              className={`flex items-center gap-4 px-4 py-3 ${
                idx < filtered.length - 1
                  ? "border-b border-default-100 dark:border-white/5"
                  : ""
              } bg-background hover:bg-default-50 dark:bg-transparent dark:hover:bg-white/[0.02]`}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fichap-primary to-fichap-accent text-[11px] font-bold text-white">
                {emp.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-default-900 dark:text-default-100">
                  {emp.name}
                </p>
                <p className="truncate text-xs text-default-500">{emp.email}</p>
              </div>
              <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                {emp.area && (
                  <span className="rounded-md bg-default-100 px-2 py-0.5 text-[11px] text-default-600 dark:bg-white/10 dark:text-default-300">
                    {emp.area}
                  </span>
                )}
                <Chip
                  size="sm"
                  variant="dot"
                  color={emp.active ? "success" : "default"}
                  classNames={{ base: "border-0 text-[11px]" }}
                >
                  {emp.active ? labels.active : labels.inactive}
                </Chip>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
