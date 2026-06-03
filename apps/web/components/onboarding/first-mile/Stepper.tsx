"use client";

import { cn } from "@/lib/utils";

interface StepperProps {
  current: number;
  total: number;
  labels: string[];
}

/**
 * 5-dot top stepper. Current step is filled violet, future steps are
 * bg-elevated. Used at the top of every wizard step.
 */
export function Stepper({ current, total, labels }: StepperProps) {
  return (
    <nav aria-label="Progress" className="flex items-center justify-center gap-2">
      <ol className="flex items-center gap-2">
        {Array.from({ length: total }).map((_, i) => {
          const isDone = i < current;
          const isCurrent = i === current;
          const label = labels[i] ?? `Step ${i + 1}`;
          return (
            <li key={i} className="flex items-center gap-2">
              <span
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`${label} ${isDone ? "(completed)" : isCurrent ? "(current)" : "(upcoming)"}`}
                className={cn(
                  "block h-2.5 w-2.5 rounded-full transition-colors",
                  isCurrent
                    ? "bg-violet-600 ring-2 ring-violet-600/30 ring-offset-2 ring-offset-app"
                    : isDone
                      ? "bg-violet-600/70"
                      : "bg-elevated"
                )}
              />
              {i < total - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px w-6 transition-colors",
                    isDone ? "bg-violet-600/40" : "bg-elevated"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
