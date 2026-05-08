import Link from "next/link";
import { ArrowRight, Bot, Workflow, MessageSquare, Zap, Shield, Sparkles, Code2 } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/workspace";

/**
 * Landing público.
 *
 * - Si el visitante ya tiene sesión, lo mandamos directo al dashboard
 *   (no queremos que un usuario logueado pierda tiempo viendo el pitch).
 * - Si no, mostramos el pitch + CTAs a /signup.
 */
export default async function WelcomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getCurrentSession();
  if (session) redirect(`/${locale}`);

  const features = [
    {
      icon: Bot,
      title: "Agentes que entienden tu negocio",
      desc: "Definí roles, prompts y herramientas. Cada agente tiene su propio modelo, knowledge base y guard-rails.",
    },
    {
      icon: Workflow,
      title: "Flujos visuales sin código",
      desc: "Conectá triggers, condiciones y acciones en un canvas. Ramas, retries y estado tipado out-of-the-box.",
    },
    {
      icon: MessageSquare,
      title: "Multi-canal real",
      desc: "Web widget, WhatsApp, Telegram, Slack, email y API. Una sola conversación, todos los canales.",
    },
    {
      icon: Zap,
      title: "Streaming token-por-token",
      desc: "Respuestas que aparecen mientras el modelo piensa. UX de primer nivel con SSE nativo.",
    },
    {
      icon: Shield,
      title: "Seguridad enterprise",
      desc: "SSO, 2FA, audit log, RBAC, GDPR, encriptación at-rest. CSP con nonce y rate-limit pluggable.",
    },
    {
      icon: Sparkles,
      title: "Costo bajo control",
      desc: "Budget mensual por empleado. Alertas a 70/90/100%. Cost breakdown por conversación y por mensaje.",
    },
  ];

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      {/* Header */}
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
            <Link href={`/${locale}/pricing`} className="hover:text-zinc-100">Precios</Link>
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
          <div className="flex items-center gap-2">
            <Link
              href={`/${locale}/login`}
              className="hidden text-sm text-zinc-400 hover:text-zinc-100 sm:inline"
            >
              Ingresar
            </Link>
            <Link
              href={`/${locale}/signup`}
              className="rounded-lg bg-violet-500 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-violet-400"
            >
              Empezar gratis
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Glow background */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(139,92,246,0.25), transparent 60%)",
          }}
        />
        <div className="mx-auto max-w-6xl px-6 pb-20 pt-24 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[11px] uppercase tracking-wider text-violet-300">
            <Sparkles className="h-3 w-3" /> Open source · Self-hostable
          </span>
          <h1 className="mt-6 font-display text-4xl font-bold tracking-tight md:text-6xl">
            La plataforma de agentes IA<br />
            <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-blue-400 bg-clip-text text-transparent">
              que tu equipo merece.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-zinc-400 md:text-lg">
            Construí, conectá y desplegá agentes en minutos. Multi-canal, multi-modelo, con
            costos bajo control y la seguridad que necesita una empresa real.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={`/${locale}/signup`}
              className="group flex items-center gap-2 rounded-xl bg-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_40px_-10px_rgba(139,92,246,0.6)] hover:bg-violet-400"
            >
              Empezar gratis
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href={`/${locale}/pricing`}
              className="rounded-xl border border-white/[0.08] px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-white/5"
            >
              Ver precios
            </Link>
          </div>
          <p className="mt-4 text-[11px] text-zinc-600">
            Plan Free para siempre · No requiere tarjeta · Self-host gratis
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-white/[0.06] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
              Todo lo que necesitás. Nada que no.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-zinc-500">
              Pensado para equipos que ya pasaron por el dolor de armar agentes con scripts sueltos.
            </p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="group rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-6 transition-colors hover:border-violet-500/30"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 text-violet-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-zinc-100">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Stack / proof points */}
      <section className="border-t border-white/[0.06] bg-zinc-950 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
                Tu modelo, tu nube, tu data.
              </h2>
              <p className="mt-3 text-sm text-zinc-400">
                Bring-your-own-key para Anthropic, OpenAI, Google y Azure. Self-host con un
                comando, o usá nuestra cloud. Tus datos nunca salen de tu infra si así lo querés.
              </p>
              <ul className="mt-5 space-y-2 text-sm text-zinc-300">
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                  <span>Postgres + pgvector para conocimiento (RAG)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                  <span>Workers en background con retry exponencial</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                  <span>Webhooks firmados (HMAC) con re-intentos automáticos</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                  <span>OpenTelemetry y métricas en tiempo real</span>
                </li>
              </ul>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-black p-1">
              <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-5 font-mono text-[11px] leading-relaxed text-zinc-300">
{`# Self-host en 30 segundos
$ git clone https://github.com/orchester-io/orchester
$ cd orchester
$ docker compose up -d

# O usá la cloud:
$ open https://orchester.io/signup

# Conectá tu primer canal:
$ curl -XPOST $URL/api/channels \\
    -d '{"type":"telegram","token":"$BOT_TOKEN"}'`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-white/[0.06] py-20">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            Listo para tu primer agente en producción?
          </h2>
          <p className="mt-3 text-sm text-zinc-400">
            Plan Free para siempre. No te pedimos tarjeta. Cancelás cuando quieras.
          </p>
          <Link
            href={`/${locale}/signup`}
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_40px_-10px_rgba(139,92,246,0.6)] hover:bg-violet-400"
          >
            Crear cuenta <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-8 text-center text-xs text-zinc-600">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6">
          <span>© {new Date().getFullYear()} Orchester</span>
          <div className="flex gap-4">
            <Link href={`/${locale}/privacy`} className="hover:text-zinc-300">Privacidad</Link>
            <Link href={`/${locale}/terms`} className="hover:text-zinc-300">Términos</Link>
            <Link href={`/${locale}/docs`} className="hover:text-zinc-300">Docs</Link>
            <a
              href="https://github.com/orchester-io/orchester"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-300"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
