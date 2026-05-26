import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Workflow,
  MessageSquare,
  Zap,
  Shield,
  Sparkles,
  Code2,
} from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/workspace";

/**
 * Public landing page.
 *
 * - If the visitor already has a session, send them straight to the dashboard
 *   (a logged-in user shouldn't have to wade through the pitch).
 * - Otherwise show the pitch + CTAs to /signup.
 */
export default async function WelcomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getCurrentSession();
  if (session) redirect(`/${locale}`);

  const features = [
    {
      icon: Bot,
      title: "Agents that understand your business",
      desc: "Define roles, prompts, and tools. Each agent gets its own model, knowledge base, and guard-rails.",
    },
    {
      icon: Workflow,
      title: "Visual flows, no code",
      desc: "Wire triggers, conditions, and actions on a canvas. Branches, retries, and typed state out of the box.",
    },
    {
      icon: MessageSquare,
      title: "Real multi-channel",
      desc: "Web widget, WhatsApp, Telegram, Slack, email, and API. One conversation, every channel.",
    },
    {
      icon: Zap,
      title: "Token-by-token streaming",
      desc: "Responses appear while the model thinks. First-class UX with native SSE.",
    },
    {
      icon: Shield,
      title: "Enterprise security",
      desc: "SSO, 2FA, audit log, RBAC, GDPR, at-rest encryption. CSP with nonce and pluggable rate limiting.",
    },
    {
      icon: Sparkles,
      title: "Cost under control",
      desc: "Monthly budget per employee. Alerts at 70/90/100%. Cost breakdown by conversation and by message.",
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
            <Link href={`/${locale}/welcome#features`} className="hover:text-zinc-100">
              Product
            </Link>
            <Link href={`/${locale}/pricing`} className="hover:text-zinc-100">
              Pricing
            </Link>
            <Link href={`/${locale}/docs`} className="hover:text-zinc-100">
              Docs
            </Link>
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
              Sign in
            </Link>
            <Link
              href={`/${locale}/signup`}
              className="rounded-lg bg-violet-500 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-violet-400"
            >
              Get started free
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
            The AI agent platform
            <br />
            <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-blue-400 bg-clip-text text-transparent">
              your team deserves.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-zinc-400 md:text-lg">
            Build, connect, and ship agents in minutes. Multi-channel, multi-model, with cost under
            control and the security a real enterprise needs.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={`/${locale}/signup`}
              className="group flex items-center gap-2 rounded-xl bg-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_40px_-10px_rgba(139,92,246,0.6)] hover:bg-violet-400"
            >
              Get started free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href={`/${locale}/pricing`}
              className="rounded-xl border border-white/[0.08] px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-white/5"
            >
              See pricing
            </Link>
          </div>
          <p className="mt-4 text-[11px] text-zinc-600">
            Free plan forever · No credit card required · Self-host for free
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-white/[0.06] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
              Everything you need. Nothing you don&apos;t.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-zinc-500">
              Built for teams who&apos;ve already lived through the pain of stitching agents
              together from loose scripts.
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
                Your model, your cloud, your data.
              </h2>
              <p className="mt-3 text-sm text-zinc-400">
                Bring-your-own-key for Anthropic, OpenAI, Google, and Azure. Self-host with one
                command, or use our cloud. Your data never leaves your infra unless you want it to.
              </p>
              <ul className="mt-5 space-y-2 text-sm text-zinc-300">
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                  <span>Postgres + pgvector for knowledge (RAG)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                  <span>Background workers with exponential retry</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                  <span>Signed webhooks (HMAC) with automatic retries</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                  <span>OpenTelemetry and real-time metrics</span>
                </li>
              </ul>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-black p-1">
              <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-5 font-mono text-[11px] leading-relaxed text-zinc-300">
                {`# Self-host in 30 seconds
$ git clone https://github.com/orchester-io/orchester
$ cd orchester
$ docker compose up -d

# Or use the cloud:
$ open https://orchester.io/signup

# Connect your first channel:
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
            Ready for your first agent in production?
          </h2>
          <p className="mt-3 text-sm text-zinc-400">
            Free plan forever. No credit card required. Cancel anytime.
          </p>
          <Link
            href={`/${locale}/signup`}
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_40px_-10px_rgba(139,92,246,0.6)] hover:bg-violet-400"
          >
            Create account <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-8 text-center text-xs text-zinc-600">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6">
          <span>© {new Date().getFullYear()} Orchester</span>
          <div className="flex gap-4">
            <Link href={`/${locale}/privacy`} className="hover:text-zinc-300">
              Privacy
            </Link>
            <Link href={`/${locale}/terms`} className="hover:text-zinc-300">
              Terms
            </Link>
            <Link href={`/${locale}/docs`} className="hover:text-zinc-300">
              Docs
            </Link>
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
