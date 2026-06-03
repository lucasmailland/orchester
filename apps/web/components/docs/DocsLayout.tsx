import Link from "next/link";
import { Bot, Code2 } from "lucide-react";
import { DOCS, type Doc, type DocBlock } from "@/lib/docs-content";

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case "h2":
      return (
        <h2 className="mt-10 scroll-mt-20 font-display text-2xl font-bold tracking-tight text-zinc-100">
          {block.text}
        </h2>
      );
    case "h3":
      return <h3 className="mt-6 text-lg font-semibold text-zinc-200">{block.text}</h3>;
    case "p":
      return <p className="mt-4 text-sm leading-relaxed text-zinc-400">{block.text}</p>;
    case "ul":
      return (
        <ul className="mt-4 space-y-2">
          {block.items.map((it) => (
            <li key={it} className="flex items-start gap-2 text-sm text-zinc-400">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      );
    case "code":
      return (
        <pre className="mt-4 overflow-x-auto rounded-xl border border-white/[0.06] bg-zinc-950 p-4 font-mono text-[12px] leading-relaxed text-zinc-300">
          <code>{block.code}</code>
        </pre>
      );
    case "callout":
      return (
        <div
          className={
            block.tone === "warn"
              ? "mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
              : "mt-5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-200"
          }
        >
          {block.text}
        </div>
      );
  }
}

export function DocsLayout({ locale, doc }: { locale: string; doc: Doc }) {
  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-black/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href={`/${locale}`} className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 text-white">
              <Bot className="h-4 w-4" />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">Orchester</span>
            <span className="ml-1 rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
              Docs
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
            <Link href={`/${locale}#features`} className="hover:text-zinc-100">
              Producto
            </Link>
            <Link href={`/${locale}/pricing`} className="hover:text-zinc-100">
              Precios
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
          <Link
            href={`/${locale}/signup`}
            className="rounded-lg bg-violet-500 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-violet-400"
          >
            Empezar gratis
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-10 px-6 py-12">
        {/* Sidebar */}
        <aside className="hidden w-56 shrink-0 md:block">
          <nav className="sticky top-24 space-y-1">
            {DOCS.map((d) => (
              <Link
                key={d.slug}
                href={`/${locale}/docs/${d.slug}`}
                className={
                  d.slug === doc.slug
                    ? "block rounded-lg bg-violet-500/15 px-3 py-1.5 text-sm font-medium text-violet-200"
                    : "block rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }
              >
                {d.title}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <article className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wider text-violet-400">Documentación</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-zinc-100">
            {doc.title}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">{doc.description}</p>
          <div className="mt-2 border-t border-white/[0.06] pt-2">
            {doc.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </div>
        </article>
      </div>

      <footer className="border-t border-white/[0.06] py-8 text-center text-xs text-zinc-600">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6">
          <span>© {new Date().getFullYear()} Orchester</span>
          <div className="flex gap-4">
            <Link href={`/${locale}/privacy`} className="hover:text-zinc-300">
              Privacidad
            </Link>
            <Link href={`/${locale}/terms`} className="hover:text-zinc-300">
              Términos
            </Link>
            <Link href={`/${locale}/pricing`} className="hover:text-zinc-300">
              Precios
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
