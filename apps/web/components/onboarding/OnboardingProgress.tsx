"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { APPLE_EASE } from "@/lib/motion";

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
}

export function OnboardingProgress({
  currentStep,
  totalSteps,
  stepLabels,
}: OnboardingProgressProps) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: totalSteps }).map((_, i) => {
        const isDone = i < currentStep;
        const isCurrent = i === currentStep;

        return (
          <div key={i} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <motion.div
                animate={{
                  backgroundColor: isDone || isCurrent ? "#3B3BFF" : "#E4E4E7",
                  scale: isCurrent ? 1.1 : 1,
                }}
                transition={{ duration: 0.3, ease: APPLE_EASE }}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                  isDone || isCurrent ? "text-white" : "text-default-400"
                )}
              >
                {isDone ? <Check size={14} strokeWidth={3} /> : i + 1}
              </motion.div>
              <span
                className={cn(
                  "hidden text-[10px] font-medium sm:block",
                  isCurrent ? "text-fichap-primary" : "text-default-400"
                )}
              >
                {stepLabels[i]}
              </span>
            </div>

            {i < totalSteps - 1 && (
              <motion.div
                className="mb-4 h-px w-8 sm:w-12"
                animate={{ backgroundColor: isDone ? "#3B3BFF" : "#E4E4E7" }}
                transition={{ duration: 0.3, ease: APPLE_EASE }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
