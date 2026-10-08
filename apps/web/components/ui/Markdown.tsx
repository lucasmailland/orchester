import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Safe markdown renderer shared by chats, conversations and previews.
 *
 * Content can come from tools reading third-party systems, so it is untrusted:
 * - raw HTML is never rendered (no rehype-raw; it shows up as text),
 * - links are limited to http/https/mailto and open hardened,
 * - images are never loaded (a remote image is a tracking/exfiltration
 *   channel); the alt text is shown instead.
 *
 * Colours inherit from the parent so it fits any bubble or theme.
 */

const SAFE_HREF = /^(https?:|mailto:)/i;

const components: Components = {
  a({ href, children }) {
    if (!href || !SAFE_HREF.test(href)) return <span>{children}</span>;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="break-words underline underline-offset-2 hover:opacity-80"
      >
        {children}
      </a>
    );
  },
  img({ alt }) {
    return alt ? <span className="italic opacity-70">{alt}</span> : null;
  },
  p: ({ children }) => <p className="my-1.5 break-words first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h3 className="mb-1 mt-3 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h4 className="mb-1 mt-3 text-[15px] font-semibold first:mt-0">{children}</h4>
  ),
  h3: ({ children }) => <h5 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h6>,
  h5: ({ children }) => <h6 className="mb-1 mt-2 text-sm font-medium first:mt-0">{children}</h6>,
  h6: ({ children }) => <h6 className="mb-1 mt-2 text-sm font-medium first:mt-0">{children}</h6>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="break-words">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-current/30 pl-3 opacity-80">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2 border-current/20" />,
  pre: ({ children }) => (
    <pre className="my-1.5 max-w-full overflow-x-auto rounded-lg bg-black/30 p-2.5 font-mono text-[12px] leading-snug">
      {children}
    </pre>
  ),
  code({ className, children }) {
    // Fenced blocks get a language class or live inside <pre>; keep inline style minimal there.
    const block = /language-/.test(className ?? "") || String(children).includes("\n");
    if (block) return <code className={cn("font-mono", className)}>{children}</code>;
    return (
      <code className="rounded bg-black/20 px-1 py-0.5 font-mono text-[0.9em] break-words">
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="my-1.5 max-w-full overflow-x-auto">
      <table className="w-max min-w-full border-collapse text-left text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-current/20 bg-black/10 px-2 py-1 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-current/20 px-2 py-1">{children}</td>,
};

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("min-w-0 max-w-full break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={(url) => (SAFE_HREF.test(url) ? url : "")}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default Markdown;
