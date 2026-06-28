"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const t = useTranslations("shell");

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-8 w-8 rounded-lg" />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      isIconOnly
      variant="light"
      size="sm"
      onPress={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? t("themeLight") : t("themeDark")}
      className="relative text-muted hover:text-strong"
    >
      <span
        className="absolute transition-all duration-200"
        style={{
          opacity: isDark ? 1 : 0,
          transform: isDark ? "rotate(0deg) scale(1)" : "rotate(-90deg) scale(0.8)",
        }}
      >
        <Sun size={16} />
      </span>
      <span
        className="absolute transition-all duration-200"
        style={{
          opacity: isDark ? 0 : 1,
          transform: isDark ? "rotate(90deg) scale(0.8)" : "rotate(0deg) scale(1)",
        }}
      >
        <Moon size={16} />
      </span>
    </Button>
  );
}
