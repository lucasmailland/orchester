"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Primitives compartidas por todas las secciones de Settings. Centralizar acá
 * los estilos repetidos garantiza que cuando cambia la "voz" del módulo (un
 * border-radius, un spacing) cambia en TODA la pantalla.
 *
 * Las clases `input`, `btn-primary`, `btn-secondary` están definidas en
 * globals.css como utilities → cualquier sección las usa sin duplicar código.
 */

export function SettingsCard({
  icon,
  title,
  description,
  action,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  /** Slot a la derecha del header — útil para "Guardar" inline. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-4",
        className
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.05] text-zinc-400">
            {icon}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
            {description && <p className="text-xs text-zinc-500">{description}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className="space-y-3">{children}</div>
    </motion.section>
  );
}

export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-zinc-400">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-zinc-600">{hint}</p>}
    </div>
  );
}

/** Toggle accesible (role=switch) reutilizable. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        checked ? "bg-violet-500" : "bg-zinc-700"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
