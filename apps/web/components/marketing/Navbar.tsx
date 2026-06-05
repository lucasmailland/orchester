"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { routing } from "@/i18n/routing";
import Link from "next/link";
import { ChevronDown, Check, Menu, X, Star } from "lucide-react";

const GithubIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

const LOCALE_FLAGS: Record<string, string> = { en: "🇺🇸", "pt-BR": "🇧🇷", es: "🇪🇸" };

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  es: "Español",
  "pt-BR": "Português",
};

function fmtStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function LocaleDropdown({ locale, onSelect }: { locale: string; onSelect: (l: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 min-w-[44px] items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
        aria-label="Select language"
        aria-expanded={open}
      >
        <span className="text-base leading-none">{LOCALE_FLAGS[locale]}</span>
        <ChevronDown
          size={12}
          className={cn("transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.15, ease: [0.22, 0.61, 0.36, 1] }}
            className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/95 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl"
          >
            {routing.locales.map((loc) => (
              <button
                key={loc}
                onClick={() => {
                  onSelect(loc);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                  locale === loc
                    ? "bg-zinc-800/60 text-white"
                    : "text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200"
                )}
              >
                <span className="text-base leading-none">{LOCALE_FLAGS[loc as string]}</span>
                <span className="flex-1 text-left">{LOCALE_LABELS[loc as string]}</span>
                {locale === loc && <Check size={13} className="text-violet-400" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Navbar() {
  const t = useTranslations("marketing.nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    fetch("https://api.github.com/repos/lucasmailland/orchester", {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.stargazers_count) setStars(data.stargazers_count as number);
      })
      .catch(() => {});
  }, []);

  function switchLocale(newLocale: string) {
    const segments = pathname.split("/");
    segments[1] = newLocale;
    router.push(segments.join("/"));
  }

  // Only real destinations. Add an entry here once a route or section
  // actually ships — never link to vapor.
  const navLinks = [{ key: "docs" as const, href: `/${locale}/docs` }];

  return (
    <>
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
        className={cn(
          "fixed top-0 z-50 w-full transition-all duration-300",
          scrolled
            ? "border-b border-zinc-800 bg-[#09090B]/85 backdrop-blur-xl"
            : "border-b border-transparent bg-transparent"
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo */}
          <Link href={`/${locale}`} className="group flex shrink-0 items-center gap-2.5">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-violet-500/30 bg-zinc-900 shadow-lg shadow-violet-500/10 transition-transform duration-300 group-hover:rotate-[8deg] group-hover:scale-105">
              <div className="absolute -inset-1 rounded-xl bg-violet-500/10 blur-lg transition-opacity duration-300 group-hover:bg-violet-500/20 group-hover:opacity-100" />
              <span className="relative font-display text-sm font-bold text-white">O</span>
            </div>
            <span className="font-display text-sm font-semibold tracking-tight text-zinc-100 transition-colors group-hover:text-white">
              Orchester
            </span>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map(({ key, href }) => (
              <Link
                key={key}
                href={href}
                className="group relative rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-white"
              >
                {t(key)}
                <span className="pointer-events-none absolute bottom-1 left-3 right-3 h-px scale-x-0 bg-gradient-to-r from-violet-400 to-cyan-400 transition-transform duration-200 group-hover:scale-x-100" />
              </Link>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Locale switcher dropdown */}
            <div className="hidden md:flex">
              <LocaleDropdown locale={locale} onSelect={switchLocale} />
            </div>

            {/* GitHub */}
            <a
              href="https://github.com/lucasmailland/orchester"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-all hover:border-zinc-700 hover:text-zinc-200 md:flex"
            >
              <GithubIcon />
              GitHub
              {stars !== null && (
                <span className="ml-1 flex items-center gap-0.5 border-l border-zinc-700 pl-1.5 text-amber-300">
                  <Star size={10} className="fill-current" /> {fmtStars(stars)}
                </span>
              )}
            </a>

            {/* CTA */}
            <Link
              href={`/${locale}/signup`}
              className="hidden items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-violet-500/20 transition-all duration-200 hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-500/30 md:flex"
            >
              {t("getStarted")}
            </Link>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-300 md:hidden"
              aria-label="Open menu"
            >
              <Menu size={16} />
            </button>
          </div>
        </div>
      </motion.header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
              className="fixed inset-y-0 right-0 z-[70] w-[280px] border-l border-zinc-800 bg-[#09090B] p-6 md:hidden"
            >
              <button
                onClick={() => setMobileOpen(false)}
                className="mb-8 flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800"
                aria-label="Close menu"
              >
                <X size={16} />
              </button>
              <nav className="space-y-1">
                {navLinks.map(({ key, href }) => (
                  <Link
                    key={key}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    className="block rounded-lg px-3 py-3 text-base text-zinc-300 hover:bg-zinc-900"
                  >
                    {t(key)}
                  </Link>
                ))}
              </nav>
              <div className="mt-6">
                <LocaleDropdown
                  locale={locale}
                  onSelect={(l) => {
                    switchLocale(l);
                    setMobileOpen(false);
                  }}
                />
              </div>
              <Link
                href={`/${locale}/signup`}
                onClick={() => setMobileOpen(false)}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white"
              >
                {t("getStarted")}
              </Link>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
