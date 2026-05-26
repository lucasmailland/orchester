"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageSelector } from "./LanguageSelector";
import { PresentationModeToggle } from "./PresentationModeToggle";
import { UserMenu } from "./UserMenu";
import { fadeInDown } from "@/lib/motion";
import { usePresentationMode } from "@/components/providers/PresentationModeProvider";
import { cn } from "@/lib/utils";

interface TopbarProps {
  /** Reserved for future locale-aware widgets in the topbar. */
  locale: string;
  userName?: string;
  userEmail?: string;
  userImage?: string | null;
}

export function Topbar({ locale: _locale, userName, userEmail, userImage }: TopbarProps) {
  const { isPresenting } = usePresentationMode();
  const t = useTranslations("shell");

  return (
    <motion.header
      variants={fadeInDown}
      initial="hidden"
      animate="visible"
      className={cn(
        "flex h-14 shrink-0 items-center justify-between px-5",
        "border-b border-line bg-surface/80 backdrop-blur-md"
      )}
    >
      {/* Left: live indicator */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-faint">
            {t("live")}
          </span>
        </div>

        {isPresenting && (
          <motion.span
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400"
          >
            {t("presentationMode")}
          </motion.span>
        )}
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-1">
        <PresentationModeToggle />
        <ThemeToggle />
        <LanguageSelector />

        <div className="ml-2 h-5 w-px bg-line" />

        <UserMenu userName={userName} userEmail={userEmail} userImage={userImage} />
      </div>
    </motion.header>
  );
}
