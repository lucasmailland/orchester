"use client";

import { useTranslations, useLocale } from "next-intl";
import { motion } from "framer-motion";
import { ArrowRight, Star } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

// Reuse the constellation canvas from the login screen — same visual language
const NeuralBackground = dynamic(
  () => import("@/components/auth/NeuralBackground").then((m) => m.NeuralBackground),
  { ssr: false, loading: () => null }
);

// Reuse the org-chart visual from the login screen — same "live agent network" feel
const AgentOrgChart = dynamic(
  () => import("@/components/auth/AgentOrgChart").then((m) => m.AgentOrgChart),
  { ssr: false, loading: () => null }
);

// ─── Inline SVG assets ──────────────────────────────────────────────────────

const GithubSVG = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

// ─── Noise overlay ───────────────────────────────────────────────────────────
const NoiseOverlay = () => (
  <svg
    className="pointer-events-none absolute inset-0 h-full w-full"
    style={{ opacity: 0.015, mixBlendMode: "overlay" }}
    aria-hidden="true"
  >
    <filter id="hero-noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
    </filter>
    <rect width="100%" height="100%" filter="url(#hero-noise)" />
  </svg>
);

// ─── Shimmer CTA Button — plain violet gradient, no sweep ───────────────────

function ShimmerButton({
  children,
  className,
  href,
}: {
  children: React.ReactNode;
  className?: string;
  href: string;
}) {
  return (
    <Link href={href} className={cn("group", className)}>
      {children}
    </Link>
  );
}

// ─── Word-stagger headline ────────────────────────────────────────────────────

function AnimatedWords({
  text,
  delayStart,
  className,
}: {
  text: string;
  delayStart: number;
  className?: string;
}) {
  const words = text.split(" ");
  return (
    <>
      {words.map((word, i) => (
        <span key={i} className="inline-block whitespace-nowrap">
          <motion.span
            className={cn("inline-block", className)}
            initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{
              delay: delayStart + i * 0.08,
              duration: 0.5,
              ease: [0.22, 0.61, 0.36, 1],
            }}
          >
            {word}
          </motion.span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

// ─── Main HeroSection ────────────────────────────────────────────────────────

export function HeroSection() {
  const t = useTranslations("marketing.hero");
  const locale = useLocale();

  return (
    <section className="relative flex min-h-[88vh] flex-col items-center justify-center overflow-hidden px-4 pt-16 sm:px-6">
      {/* Constellation background — same canvas as the login screen */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <NeuralBackground />
      </div>

      {/* Brand-accent glow behind the chart */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 top-1/3 -z-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 90%, rgba(139,92,246,0.18), transparent 70%)",
        }}
      />

      {/* Vignette — fade the wave edges into the page bg so it doesn't fight the next section */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 0%, transparent 30%, rgba(9,9,11,0.55) 70%, #09090B 100%)",
        }}
        aria-hidden="true"
      />

      {/* Noise grain overlay */}
      <NoiseOverlay />

      {/* Dot grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: "radial-gradient(circle, #a78bfa 1px, transparent 1px)",
          backgroundSize: "30px 30px",
        }}
      />

      {/* Drifting grid */}
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(167,139,250,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(167,139,250,0.5) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
        animate={{ backgroundPosition: ["0px 0px", "60px 60px"] }}
        transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
      />

      {/* 2-column grid: text left, chart right */}
      <div className="relative z-10 mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
        {/* LEFT COLUMN — badge, headline, subheadline, CTAs */}
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
            className="mb-7 inline-flex items-center gap-2.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-xs font-medium tracking-wide text-violet-400">{t("badge")}</span>
          </motion.div>

          {/* Headline — word-stagger reveal */}
          <h1 className="mb-6 font-display text-5xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl">
            <span className="block">
              <AnimatedWords text={t("headline1")} delayStart={0.12} />
            </span>
            <span className="block bg-gradient-to-r from-violet-400 via-violet-300 to-violet-200 bg-clip-text text-transparent">
              <AnimatedWords text={t("headline2")} delayStart={0.3} />
            </span>
          </h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55, duration: 0.5 }}
            className="mt-6 mb-10 max-w-xl text-base leading-relaxed text-zinc-400 sm:text-lg"
          >
            {t("subheadline")}
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.5 }}
            className="flex flex-row items-center gap-3 justify-center lg:justify-start"
          >
            {/* Primary CTA */}
            <ShimmerButton
              href={`/${locale}/signup`}
              className={cn(
                "flex items-center gap-2 rounded-xl px-7 py-3.5 text-sm font-semibold text-white",
                "bg-gradient-to-r from-violet-600 to-violet-500",
                "shadow-2xl shadow-black/30 transition-all duration-200",
                "hover:scale-[1.02] hover:from-violet-500 hover:to-violet-400"
              )}
            >
              {t("ctaPrimary")}
              <ArrowRight
                size={14}
                className="transition-transform duration-150 group-hover:translate-x-0.5"
              />
            </ShimmerButton>

            <a
              href="https://github.com/lucasmailland/orchester"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "group flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-7 py-3.5 text-sm font-medium text-zinc-300",
                "transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"
              )}
            >
              <GithubSVG />
              {t("ctaGithub")}
              <span className="flex items-center gap-1 rounded-md bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500 transition-colors group-hover:text-zinc-300">
                <Star size={10} className="text-zinc-500" />
                <span className="hidden sm:inline">GitHub</span>
              </span>
            </a>
          </motion.div>
        </div>

        {/* RIGHT COLUMN — Live Network pill + AgentOrgChart */}
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5, duration: 0.8, ease: [0.22, 0.61, 0.36, 1] }}
          className="flex flex-col items-center lg:items-end"
        >
          {/* Live Network pill — static, no animation */}
          <div
            className="mb-6 flex items-center gap-2"
            style={{ fontFamily: "var(--font-auth-mono), monospace" }}
          >
            <span className="inline-flex h-1 w-1 shrink-0 rounded-full bg-violet-400/70" />
            <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              {t("liveNetwork")}
            </span>
          </div>

          {/* AgentOrgChart */}
          <div className="mx-auto scale-95 lg:scale-100">
            <AgentOrgChart />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
