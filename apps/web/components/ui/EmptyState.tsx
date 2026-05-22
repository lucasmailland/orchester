"use client";

import { motion } from "framer-motion";
import { Button } from "@heroui/react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { APPLE_EASE } from "@/lib/motion";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  ctaLabel?: string;
  onCta?: () => void;
  ctaHref?: string;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  onCta,
  ctaHref,
  className,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: APPLE_EASE }}
      className={cn(
        "flex flex-col items-center justify-center gap-5 rounded-2xl",
        "border border-dashed border-white/[0.09] bg-card p-14",
        className
      )}
    >
      {icon && (
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-600/25 to-blue-600/15" />
          <div className="absolute inset-0 rounded-2xl border border-violet-500/20" />
          <div className="relative text-violet-400">{icon}</div>
        </div>
      )}

      <div className="space-y-1.5 text-center">
        <h3 className="text-sm font-semibold text-body">{title}</h3>
        {description && (
          <p className="max-w-xs text-sm leading-relaxed text-muted">{description}</p>
        )}
      </div>

      {ctaLabel && (onCta || ctaHref) && (
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
          {ctaHref ? (
            <Button
              as={Link}
              href={ctaHref}
              size="sm"
              className="bg-gradient-to-r from-violet-600 to-blue-600 font-medium text-white shadow-lg shadow-violet-500/20"
            >
              {ctaLabel}
            </Button>
          ) : (
            <Button
              size="sm"
              {...(onCta ? { onPress: onCta } : {})}
              className="bg-gradient-to-r from-violet-600 to-blue-600 font-medium text-white shadow-lg shadow-violet-500/20"
            >
              {ctaLabel}
            </Button>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
