import Link from "next/link";
import { Check } from "lucide-react";
import { PLANS } from "@/lib/billing/plans";

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const plans: Array<{ id: keyof typeof PLANS; bullets: string[]; cta: string; highlight?: boolean }> = [
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
    <div className="min-h-screen bg-black px-6 py-16 text-zinc-100">
      <div className="mx-auto max-w-6xl">
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
                    ? "relative rounded-2xl border border-violet-500/40 bg-zinc-900/60 p-6 shadow-[0_0_60px_-20px_rgba(139,92,246,0.4)]"
                    : "relative rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-6"
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
                <ul className="mt-5 space-y-2 text-xs text-zinc-300">
                  {p.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" /> {b}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/${locale}/signup?plan=${p.id}`}
                  className={
                    p.highlight
                      ? "mt-6 block rounded-lg bg-violet-500 py-2 text-center text-sm font-medium text-white hover:bg-violet-400"
                      : "mt-6 block rounded-lg border border-white/[0.08] py-2 text-center text-sm font-medium text-zinc-200 hover:bg-white/5"
                  }
                >
                  {p.cta}
                </Link>
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
    </div>
  );
}
