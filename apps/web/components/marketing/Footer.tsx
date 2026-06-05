"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";

const GithubIcon = ({ size = 12 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

export function Footer() {
  const t = useTranslations("marketing.footer");
  const locale = useLocale();

  // Real destinations only. Anything aspirational (changelog, blog,
  // careers, status page…) stays out until it actually ships.
  const links: Array<{ label: string; href: string; external?: boolean }> = [
    { label: t("links.docs"), href: `/${locale}/docs` },
    {
      label: t("links.github"),
      href: "https://github.com/lucasmailland/orchester",
      external: true,
    },
    { label: t("links.privacy"), href: `/${locale}/privacy` },
    { label: t("links.terms"), href: `/${locale}/terms` },
  ];

  return (
    <footer className="border-t border-zinc-800/60 bg-[#09090B]">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Top row: brand on the left, real links on the right */}
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-violet-500/30 bg-zinc-900">
              <span className="font-display text-xs font-bold text-white">O</span>
            </div>
            <div className="flex flex-col">
              <span className="font-display text-sm font-semibold text-zinc-200">Orchester</span>
              <span className="text-xs text-zinc-500">{t("tagline")}</span>
            </div>
          </div>

          <nav aria-label={t("ariaLabel")} className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {links.map((link) =>
              link.external ? (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-200"
                >
                  <GithubIcon size={12} />
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.label}
                  href={link.href}
                  className="text-sm text-zinc-500 transition-colors hover:text-zinc-200"
                >
                  {link.label}
                </Link>
              )
            )}
          </nav>
        </div>

        {/* Bottom row: legal stamp */}
        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-zinc-800/60 pt-6 text-xs text-zinc-500 sm:flex-row">
          <p>© {new Date().getFullYear()} Orchester · Apache-2.0</p>
          <p>{t("madeIn")}</p>
        </div>
      </div>
    </footer>
  );
}
