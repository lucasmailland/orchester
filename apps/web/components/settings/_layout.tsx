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
      className={cn("rounded-2xl border border-line bg-card p-5 space-y-4", className)}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-hover text-muted">
            {icon}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-strong">{title}</h2>
            {description && <p className="text-xs text-muted">{description}</p>}
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
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-faint">{hint}</p>}
    </div>
  );
}

/** Toggle accesible (role=switch) reutilizable.
 *
 * Pre-fix: the knob was positioned with `translate-x-*` only and the
 * span had `absolute` with no explicit positional anchors. Some upstream
 * CSS (HeroUI / Tailwind reset under @layer base) was matching the
 * span via the parent's `[role="switch"]` selector and forcing
 * `left:18px; right:2px` on it, which composed with the 16px transform
 * and pushed the knob ~14px past the right edge of the track — the
 * "bolita fuera de lugar" the user reported.
 *
 * Fix: set explicit `left: 2px` (the gutter) and ditch the transform.
 * Use `style.transform` directly to bypass any utility-class
 * specificity wars, and clamp dimensions with inline-flex so the
 * knob can never escape the track. Same visual result; immune to
 * upstream resets.
 */
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
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full",
        "transition-colors duration-200",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        checked ? "bg-violet-500" : "bg-zinc-300 dark:bg-zinc-700"
      )}
    >
      <span
        // Inline style overrides any upstream `[role="switch"] > *`
        // rule that tries to anchor children to both sides.
        style={{
          left: 0,
          right: "auto",
          transform: `translateX(${checked ? "18px" : "2px"})`,
        }}
        className="pointer-events-none absolute h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200"
      />
    </button>
  );
}
