"use client";

import { useTranslations, useLocale } from "next-intl";
import { Github } from "lucide-react";
import Link from "next/link";

export function Footer() {
  const t = useTranslations("marketing.footer");
  const locale = useLocale();

  const columns = [
    {
      title: t("product"),
      links: [
        { label: t("links.docs"), href: `/${locale}/docs` },
        { label: t("links.pricing"), href: `/${locale}/pricing` },
        { label: t("links.changelog"), href: "#changelog" },
      ],
    },
    {
      title: t("company"),
      links: [
        {
          label: t("links.github"),
          href: "https://github.com/lucasmailland/orchester",
          external: true,
        },
      ],
    },
    {
      title: t("legal"),
      links: [
        { label: t("links.privacy"), href: `/${locale}/privacy` },
        { label: t("links.terms"), href: `/${locale}/terms` },
      ],
    },
  ];

  return (
    <footer className="border-t border-zinc-800/60 bg-[#09090B]">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-md border border-violet-500/30 bg-zinc-900">
                <span className="font-display text-xs font-bold text-white">O</span>
              </div>
              <span className="font-display text-sm font-semibold text-zinc-200">Orchester</span>
            </div>
            <p className="mt-3 max-w-[200px] text-xs leading-relaxed text-zinc-600">
              {t("tagline")}
            </p>
            <a
              href="https://github.com/lucasmailland/orchester"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-xs text-zinc-600 transition-colors hover:text-zinc-400"
            >
              <Github size={12} />
              GitHub
            </a>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {col.title}
              </h4>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {"external" in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-zinc-600 transition-colors hover:text-zinc-300"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-zinc-600 transition-colors hover:text-zinc-300"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-zinc-800/60 pt-6 sm:flex-row">
          <p className="text-xs text-zinc-700">
            © {new Date().getFullYear()} Orchester. Apache-2.0.
          </p>
          <p className="text-xs text-zinc-700">Made with ♥ in Buenos Aires</p>
        </div>
      </div>
    </footer>
  );
}
