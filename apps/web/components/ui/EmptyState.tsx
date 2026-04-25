"use client";

import { motion } from "framer-motion";
import { Button } from "@heroui/react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  ctaLabel?: string;
  onCta?: () => void;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  onCta,
  className,
}: EmptyStateProps) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-2xl",
        "border border-dashed border-default-200 bg-default-50/50 p-12",
        "dark:border-white/10 dark:bg-white/[0.02]",
        className
      )}
    >
      {icon && (
        <motion.div
          variants={staggerItem}
          className="rounded-2xl bg-fichap-primary/10 p-4 text-fichap-primary dark:bg-fichap-primary/20"
        >
          {icon}
        </motion.div>
      )}

      <motion.div variants={staggerItem} className="space-y-1 text-center">
        <h3 className="text-base font-semibold text-default-800 dark:text-default-100">
          {title}
        </h3>
        <p className="max-w-sm text-sm text-default-500">{description}</p>
      </motion.div>

      {ctaLabel && onCta && (
        <motion.div variants={staggerItem} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Button
            color="primary"
            size="sm"
            onPress={onCta}
            className="bg-[#3B3BFF] font-medium"
          >
            {ctaLabel}
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}
