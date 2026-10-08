/**
 * Markdown to Odoo-friendly HTML, for notes that flows and agents post.
 *
 * Pure and dependency-free (like `escape.ts`), so flow validation can run it in
 * the browser too. Models write Markdown naturally; asking them for raw HTML
 * is fragile and puts unsanitised model output in a ticket.
 *
 * Safety: the input is never interpreted as HTML. Every piece of text goes
 * through `htmlEscape` as it is emitted, the only tags are the ones this file
 * writes, and the only attribute is `href` on an http(s) link.
 *
 * Cost: one pass per line, and every delimiter search either consumes what it
 * finds or is remembered as failed, so a pathological input (long runs of
 * `*`, `_`, backticks, brackets) stays linear. There are no regexes with
 * nested quantifiers over unbounded input.
 *
 * Supported: paragraphs, `#` headings (shrunk to h3/h4), bold, italic, inline
 * code, fenced code, bullet and numbered lists (one nested level), http(s)
 * links and `---` rules. Everything else is shown as the text it is.
 */
import { htmlEscape } from "./escape";

type Kind = "b*" | "b_" | "i*" | "i_" | "a";

const ESCAPABLE = "\\`*_[]()#+-.!";
const isSpace = (c: string | undefined) => c === undefined || c === " " || c === "\t";
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Only absolute http(s) URLs without whitespace or control characters. */
function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(url)) return null;
  return url;
}

/** First index of `ch` at or after `from`, remembering "none left". */
function cachedIndexOf(s: string, ch: string, from: number, cache: { pos: number | null }): number {
  if (cache.pos === -1) return -1;
  if (cache.pos !== null && cache.pos >= from) return cache.pos;
  cache.pos = s.indexOf(ch, from);
  return cache.pos;
}

/** Closing delimiter run of exactly `len` `ch`, preceded by a non-space. */
function findEmphasisClose(s: string, from: number, ch: string, len: number): number {
  let k = from;
  for (;;) {
    const j = s.indexOf(ch, k);
    if (j === -1) return -1;
    let e = j;
    while (e < s.length && s[e] === ch) e++;
    if (e - j === len && j > from && !isSpace(s[j - 1]) && (ch === "*" || !isWordChar(s[e]))) {
      return j;
    }
    k = e;
  }
}

/** Closing backtick run of exactly `len`, or -1. */
function findCodeClose(s: string, from: number, len: number): number {
  let k = from;
  for (;;) {
    const j = s.indexOf("`", k);
    if (j === -1) return -1;
    let e = j;
    while (e < s.length && s[e] === "`") e++;
    if (e - j === len) return j;
    k = e;
  }
}

function renderInline(s: string, disabled: ReadonlySet<Kind>): string {
  const n = s.length;
  const out: string[] = [];
  const failed = new Set<string>();
  const bracket = { pos: null as number | null };
  const paren = { pos: null as number | null };
  let lit = 0;
  let i = 0;

  const flush = (to: number) => {
    if (to > lit) out.push(htmlEscape(s.slice(lit, to)));
  };
  const emit = (html: string, next: number) => {
    out.push(html);
    i = next;
    lit = next;
  };

  while (i < n) {
    const c = s[i]!;

    if (c === "\\" && i + 1 < n && ESCAPABLE.includes(s[i + 1]!)) {
      flush(i);
      emit(htmlEscape(s[i + 1]!), i + 2);
      continue;
    }

    if (c === "`") {
      let e = i;
      while (e < n && s[e] === "`") e++;
      const len = e - i;
      const key = `\`${len}`;
      if (!failed.has(key)) {
        const j = findCodeClose(s, e, len);
        if (j === -1) failed.add(key);
        else if (j > e) {
          let code = s.slice(e, j);
          if (code.length > 1 && code.startsWith(" ") && code.endsWith(" "))
            code = code.slice(1, -1);
          flush(i);
          emit(`<code>${htmlEscape(code)}</code>`, j + len);
          continue;
        }
      }
      i = e;
      continue;
    }

    if (c === "[" && !disabled.has("a")) {
      const close = cachedIndexOf(s, "]", i + 1, bracket);
      if (close > i + 1 && s[close + 1] === "(") {
        const end = cachedIndexOf(s, ")", close + 2, paren);
        const url = end === -1 ? null : safeUrl(s.slice(close + 2, end));
        if (end !== -1 && url) {
          const inner = renderInline(s.slice(i + 1, close), new Set([...disabled, "a" as Kind]));
          flush(i);
          emit(`<a href="${htmlEscape(url)}">${inner}</a>`, end + 1);
          continue;
        }
      }
      i++;
      continue;
    }

    if (c === "*" || c === "_") {
      let e = i;
      while (e < n && s[e] === c) e++;
      const run = e - i;
      const kind = `${run === 1 ? "i" : "b"}${c}` as Kind;
      const opens =
        (run === 1 || run === 2) &&
        !isSpace(s[e]) &&
        !(c === "_" && isWordChar(s[i - 1])) &&
        !disabled.has(kind) &&
        !failed.has(kind);
      if (opens) {
        const j = findEmphasisClose(s, e, c, run);
        if (j === -1) failed.add(kind);
        else {
          const inner = renderInline(s.slice(e, j), new Set([...disabled, kind]));
          const tag = run === 1 ? "i" : "b";
          flush(i);
          emit(`<${tag}>${inner}</${tag}>`, j + run);
          continue;
        }
      }
      i = e;
      continue;
    }

    i++;
  }
  flush(n);
  return out.join("");
}

interface ListLine {
  indent: number;
  ordered: boolean;
  num: number;
  text: string;
}

function leadingIndent(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w++;
    else if (ch === "\t") w += 4;
    else break;
  }
  return w;
}

function parseListLine(line: string): ListLine | null {
  const indent = leadingIndent(line);
  const t = line.trimStart();
  const m = t[0];
  if ((m === "-" || m === "*" || m === "+") && (t[1] === " " || t[1] === "\t")) {
    const text = t.slice(2).trim();
    // `* * *` and `- - -` are rules, not lists.
    if (isRule(t)) return null;
    return { indent, ordered: false, num: 0, text };
  }
  let d = 0;
  while (d < t.length && d < 10 && t[d]! >= "0" && t[d]! <= "9") d++;
  if (
    d > 0 &&
    d < 10 &&
    (t[d] === "." || t[d] === ")") &&
    (t[d + 1] === " " || t[d + 1] === "\t")
  ) {
    return { indent, ordered: true, num: Number(t.slice(0, d)), text: t.slice(d + 2).trim() };
  }
  return null;
}

function isRule(line: string): boolean {
  const t = line.trim();
  if (t.length < 3) return false;
  const c = t[0];
  if (c !== "-" && c !== "*" && c !== "_") return false;
  let count = 0;
  for (const ch of t) {
    if (ch === c) count++;
    else if (ch !== " ") return false;
  }
  return count >= 3;
}

function parseHeading(line: string): { level: number; text: string } | null {
  const t = line.trimStart();
  if (line.length - t.length > 3) return null;
  let level = 0;
  while (level < t.length && t[level] === "#") level++;
  if (level < 1 || level > 6 || (t[level] !== " " && t[level] !== "\t")) return null;
  let end = t.length;
  while (end > level && (t[end - 1] === " " || t[end - 1] === "\t")) end--;
  // Optional closing run of #, only when separated by a space.
  let h = end;
  while (h > level && t[h - 1] === "#") h--;
  if (h < end && h > level && (t[h - 1] === " " || t[h - 1] === "\t")) {
    end = h;
    while (end > level && (t[end - 1] === " " || t[end - 1] === "\t")) end--;
  }
  return { level, text: t.slice(level, end).trim() };
}

const isFence = (line: string) => line.trimStart().startsWith("```");

function renderList(items: ListLine[]): string {
  const base = items[0]!.indent;
  const html: string[] = [];
  let top: "ul" | "ol" | null = null;
  let sub: "ul" | "ol" | null = null;
  let liOpen = false;

  const closeSub = () => {
    if (sub) html.push(`</${sub}>`);
    sub = null;
  };
  const closeLi = () => {
    closeSub();
    if (liOpen) html.push("</li>");
    liOpen = false;
  };

  for (const it of items) {
    const tag = it.ordered ? "ol" : "ul";
    const text = renderInline(it.text, new Set());
    if (it.indent >= base + 2 && liOpen) {
      if (sub !== tag) {
        closeSub();
        html.push(`<${tag}>`);
        sub = tag;
      }
      html.push(`<li>${text}</li>`);
      continue;
    }
    closeLi();
    if (top !== tag) {
      if (top) html.push(`</${top}>`);
      html.push(`<${tag}>`);
      top = tag;
    }
    html.push(`<li>${text}`);
    liOpen = true;
  }
  closeLi();
  if (top) html.push(`</${top}>`);
  return html.join("");
}

export function markdownToHtml(md: string): string {
  const lines = md.split(/\r\n|\r|\n/);
  const out: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map((l) => renderInline(l, new Set())).join("<br>")}</p>`);
      para = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (isFence(line)) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !isFence(lines[i]!)) body.push(lines[i++]!);
      i++; // the closing fence, if any
      out.push(`<pre><code>${body.map(htmlEscape).join("\n")}</code></pre>`);
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      flushPara();
      const tag = heading.level <= 2 ? "h3" : "h4";
      out.push(`<${tag}>${renderInline(heading.text, new Set())}</${tag}>`);
      i++;
      continue;
    }

    if (isRule(line)) {
      flushPara();
      out.push("<hr>");
      i++;
      continue;
    }

    const first = parseListLine(line);
    // A numbered line only interrupts a paragraph when it starts at 1, so a
    // sentence that happens to begin "2024. " is not turned into a list.
    if (first && (para.length === 0 || !first.ordered || first.num === 1)) {
      flushPara();
      const items: ListLine[] = [first];
      i++;
      while (i < lines.length) {
        const l = lines[i]!;
        const item = parseListLine(l);
        if (item) {
          items.push(item);
          i++;
        } else if (l.trim() === "") {
          // A blank line continues the list only if another item follows.
          let k = i;
          while (k < lines.length && lines[k]!.trim() === "") k++;
          if (k < lines.length && parseListLine(lines[k]!)) i = k;
          else break;
        } else if (!isFence(l) && !parseHeading(l) && !isRule(l) && leadingIndent(l) > 0) {
          // Indented continuation of the previous item.
          const last = items[items.length - 1]!;
          last.text = `${last.text} ${l.trim()}`;
          i++;
        } else break;
      }
      out.push(renderList(items));
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  return out.join("");
}
