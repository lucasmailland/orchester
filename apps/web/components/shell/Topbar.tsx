"use client";

import { motion } from "framer-motion";
import { Avatar } from "@heroui/react";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageSelector } from "./LanguageSelector";
import { PresentationModeToggle } from "./PresentationModeToggle";
import { fadeInDown } from "@/lib/motion";
import { usePresentationMode } from "@/components/providers/PresentationModeProvider";
import { cn } from "@/lib/utils";

interface TopbarProps {
  locale: string;
}

export function Topbar({ locale: _locale }: TopbarProps) {
  const { isPresenting } = usePresentationMode();

  return (
    <motion.header
      variants={fadeInDown}
      initial="hidden"
      animate="visible"
      className={cn(
        "flex h-14 shrink-0 items-center justify-between border-b px-6",
        "border-default-100 bg-background/80 dark:border-white/5",
        "backdrop-blur-md"
      )}
    >
      {/* Left */}
      <div className="flex items-center gap-2">
        {isPresenting && (
          <motion.span
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            className="rounded-full bg-fichap-primary/10 px-2.5 py-0.5 text-xs font-medium text-fichap-primary"
          >
            Presentation Mode
          </motion.span>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-1">
        <PresentationModeToggle />
        <ThemeToggle />
        <LanguageSelector />
        <div className="ml-2 cursor-pointer">
          <Avatar
            size="sm"
            name="Demo User"
            classNames={{
              base: "bg-gradient-to-br from-fichap-primary to-fichap-accent",
              name: "text-white font-semibold text-xs",
            }}
          />
        </div>
      </div>
    </motion.header>
  );
}
