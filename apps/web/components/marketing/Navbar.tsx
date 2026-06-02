"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Github } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { routing } from "@/i18n/routing";
import Link from "next/link";

const LOCALE_FLAGS: Record<string, string> = { en: "🇺🇸", "pt-BR": "🇧🇷", es: "🇪🇸" };

export function Navbar() {
  const t = useTranslations("marketing.nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  function switchLocale(newLocale: string) {
    const segments = pathname.split("/");
    segments[1] = newLocale;
    router.push(segments.join("/"));
  }

  const navLinks = [
    { key: "docs" as const, href: `/${locale}/docs` },
    { key: "pricing" as const, href: `/${locale}/pricing` },
    { key: "changelog" as const, href: "#changelog" },
  ];

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
      className={cn(
        "fixed top-0 z-50 w-full transition-all duration-300",
        scrolled
          ? "border-b border-zinc-800/80 bg-[#09090B]/90 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href={`/${locale}`} className="flex shrink-0 items-center gap-2.5">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-violet-500/30 bg-zinc-900 shadow-lg shadow-violet-500/10">
            <div className="absolute -inset-1 rounded-xl bg-violet-500/10 blur-lg" />
            <span className="relative font-display text-sm font-bold text-white">O</span>
          </div>
          <span className="font-display text-sm font-semibold tracking-tight text-zinc-100">
            Orchester
          </span>
        </Link>

        {/* Desktop nav links */}
        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map(({ key, href }) => (
            <Link
              key={key}
              href={href}
              className="rounded-lg px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-900/50 hover:text-zinc-200"
            >
              {t(key)}
            </Link>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Locale switcher */}
          <div className="hidden items-center rounded-lg border border-zinc-800 bg-zinc-900/30 p-0.5 md:flex">
            {routing.locales.map((loc) => (
              <button
                key={loc}
                onClick={() => switchLocale(loc)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs transition-all duration-150",
                  locale === loc
                    ? "bg-zinc-700 text-zinc-100 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-400"
                )}
              >
                {LOCALE_FLAGS[loc as string]}
              </button>
            ))}
          </div>

          {/* GitHub */}
          <a
            href="https://github.com/lucasmailland/orchester"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "hidden items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 md:flex",
              "transition-all hover:border-zinc-700 hover:text-zinc-200"
            )}
          >
            <Github size={13} />
            GitHub
          </a>

          {/* CTA */}
          <Link
            href={`/${locale}/signup`}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white",
              "bg-gradient-to-r from-violet-600 to-indigo-600",
              "shadow-md shadow-violet-500/20 transition-all duration-200",
              "hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-500/30"
            )}
          >
            {t("getStarted")}
          </Link>
        </div>
      </div>
    </motion.header>
  );
}
