import Link from "next/link";
import { DOCS, type Doc, type DocBlock } from "@/lib/docs-content";
import { Navbar } from "@/components/marketing/Navbar";
import { Footer } from "@/components/marketing/Footer";

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
    <div className="min-h-screen bg-[#09090B] text-zinc-100">
      {/* Same chrome as the landing — fixed glass navbar at top */}
      <Navbar />

      <div className="mx-auto flex max-w-6xl gap-10 px-6 pb-16 pt-28">
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

      <Footer />
    </div>
  );
}
