"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Input } from "@heroui/react";
import { Search, DollarSign, Pencil } from "lucide-react";
import { toast } from "sonner";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  area: string | null;
  active: boolean;
  monthlyBudgetUsd?: string | null;
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

export function EmployeeTable({ employees: initial, labels }: EmployeeTableProps) {
  const [query, setQuery] = useState("");
  const [employees, setEmployees] = useState<Employee[]>(initial);

  const filtered = employees.filter((e) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q);
  });

  async function editBudget(emp: Employee) {
    const current = emp.monthlyBudgetUsd != null ? Number(emp.monthlyBudgetUsd) : null;
    const raw = window.prompt(
      `Budget mensual en USD para ${emp.name} (vacío = sin límite)`,
      current != null ? String(current) : ""
    );
    if (raw === null) return; // cancelado
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      toast.error("El budget debe ser un número ≥ 0 o vacío");
      return;
    }
    const r = await fetch(`/api/employees/${emp.id}/budget`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monthlyBudgetUsd: value }),
    });
    if (!r.ok) {
      toast.error("No se pudo actualizar");
      return;
    }
    setEmployees((prev) =>
      prev.map((e) =>
        e.id === emp.id ? { ...e, monthlyBudgetUsd: value == null ? null : String(value) } : e
      )
    );
    toast.success(value == null ? "Budget removido" : `Budget: $${value}/mes`);
  }

  return (
    <div className="space-y-4">
      <Input
        value={query}
        onValueChange={setQuery}
        placeholder={labels.search}
        startContent={<Search size={15} className="shrink-0 text-muted" />}
        classNames={{ inputWrapper: "bg-surface border-line max-w-sm" }}
        size="sm"
      />

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">{labels.empty}</p>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="overflow-hidden rounded-xl border border-line"
        >
          {filtered.map((emp, idx) => (
            <motion.div
              key={emp.id}
              variants={staggerItem}
              className={cn(
                "flex items-center gap-4 px-4 py-3 bg-card hover:bg-card transition-colors",
                idx < filtered.length - 1 && "border-b border-line"
              )}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-blue-600 text-[11px] font-bold text-white">
                {emp.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-strong">{emp.name}</p>
                <p className="truncate text-xs text-muted">{emp.email}</p>
              </div>
              <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                {emp.area && (
                  <span className="rounded-md border border-zinc-700/50 bg-surface px-2 py-0.5 text-[11px] text-muted">
                    {emp.area}
                  </span>
                )}
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", emp.active ? "bg-emerald-400" : "bg-zinc-600")} />
                  <span className={cn("text-[11px] font-medium", emp.active ? "text-emerald-600 dark:text-emerald-400" : "text-muted")}>
                    {emp.active ? labels.active : labels.inactive}
                  </span>
                </div>
              </div>
              {/* Budget mensual: pill clickeable que abre prompt para editar.
                  Sin budget configurado → "Sin límite" en gris. */}
              <button
                type="button"
                onClick={() => editBudget(emp)}
                className={cn(
                  "ml-2 hidden shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] sm:inline-flex",
                  emp.monthlyBudgetUsd != null
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                    : "border-line text-muted hover:bg-hover hover:text-body"
                )}
                aria-label={`Editar budget de ${emp.name}`}
              >
                <DollarSign className="h-3 w-3" />
                {emp.monthlyBudgetUsd != null
                  ? `$${Number(emp.monthlyBudgetUsd).toFixed(0)}/mes`
                  : "Sin límite"}
                <Pencil className="h-2.5 w-2.5 opacity-60" />
              </button>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
