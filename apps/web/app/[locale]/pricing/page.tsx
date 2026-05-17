import Link from "next/link";
import { Check, Bot, Code2 } from "lucide-react";
import { PLANS } from "@/lib/billing/plans";
import { PricingCta } from "@/components/billing/PricingCta";

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const plans: Array<{ id: "free" | "starter" | "pro" | "business"; bullets: string[]; cta: string; highlight?: boolean }> = [
    {
      id: "free",
      bullets: ["3 agentes", "100 conversaciones/mes", "50K tokens", "1 usuario", "Comunidad"],
      cta: "Empezar gratis",
    },
    {
      id: "starter",
      bullets: ["10 agentes", "1.000 convs/mes", "500K tokens", "3 usuarios", "Web Widget + Telegram"],
      cta: "Probar Starter",
    },
    {
      id: "pro",
      bullets: ["50 agentes", "10K convs/mes", "5M tokens", "10 usuarios", "Todos los canales", "Conocimiento (RAG)"],
      cta: "Suscribirse Pro",
      highlight: true,
    },
    {
      id: "business",
      bullets: ["Agentes ilimitados", "100K convs/mes", "50M tokens", "50 usuarios", "Audit log + RBAC", "SLA"],
      cta: "Hablar con ventas",
    },
  ];
  return (
    <div className="min-h-screen bg-black text-zinc-100">
      {/* Header (mismo chrome que el landing público) */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-black/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href={`/${locale}/welcome`} className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 text-white">
              <Bot className="h-4 w-4" />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">Orchester</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
            <Link href={`/${locale}/welcome#features`} className="hover:text-zinc-100">Producto</Link>
            <Link href={`/${locale}/pricing`} className="text-zinc-100">Precios</Link>
            <Link href={`/${locale}/docs`} className="hover:text-zinc-100">Docs</Link>
            <a
              href="https://github.com/orchester-io/orchester"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-zinc-100"
            >
              <Code2 className="h-3.5 w-3.5" /> GitHub
            </a>
          </nav>
          <Link
            href={`/${locale}/login`}
            className="rounded-lg border border-white/[0.08] px-3.5 py-1.5 text-sm text-zinc-300 hover:bg-white/5"
          >
            Ingresar
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight">Precios</h1>
          <p className="mt-3 text-sm text-zinc-500">
            Empezá gratis, escalá cuando lo necesites. Sin trampas, cancelás cuando quieras.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => {
            const meta = PLANS[p.id];
            return (
              <div
                key={p.id}
                className={
                  p.highlight
                    ? "relative flex flex-col rounded-2xl border border-violet-500/40 bg-zinc-900/60 p-6 shadow-[0_0_60px_-20px_rgba(139,92,246,0.4)]"
                    : "relative flex flex-col rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-6"
                }
              >
                {p.highlight && (
                  <span className="absolute -top-2.5 left-6 rounded-full bg-violet-500 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                    Recomendado
                  </span>
                )}
                <h2 className="text-lg font-semibold text-zinc-100">{meta.name}</h2>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-zinc-100">${meta.priceUsd}</span>
                  <span className="text-xs text-zinc-500">/mes</span>
                </div>
                <ul className="mt-5 flex-1 space-y-2 text-xs text-zinc-300">
                  {p.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" /> {b}
                    </li>
                  ))}
                </ul>
                <PricingCta locale={locale} plan={p.id} label={p.cta} highlight={p.highlight ?? false} />
              </div>
            );
          })}
        </div>

        <div className="mt-10 text-center text-xs text-zinc-500">
          Plan <strong>Enterprise</strong> con uso ilimitado, SSO/SAML, on-prem y soporte dedicado:{" "}
          <a href="mailto:enterprise@orchester.io" className="text-violet-400 underline">
            enterprise@orchester.io
          </a>
        </div>
      </div>

      <footer className="border-t border-white/[0.06] py-8 text-center text-xs text-zinc-600">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6">
          <span>© {new Date().getFullYear()} Orchester</span>
          <div className="flex gap-4">
            <Link href={`/${locale}/privacy`} className="hover:text-zinc-300">Privacidad</Link>
            <Link href={`/${locale}/terms`} className="hover:text-zinc-300">Términos</Link>
            <Link href={`/${locale}/docs`} className="hover:text-zinc-300">Docs</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
