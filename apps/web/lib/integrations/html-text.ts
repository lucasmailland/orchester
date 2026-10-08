/**
 * Odoo stores notes and descriptions as HTML. A model reads text, and markup is
 * both noise and a way to smuggle instructions in, so tags are dropped and the
 * result is capped. This is a reader, not a sanitiser for rendering.
 */
export function htmlToText(html: unknown, maxLength = 1500): string {
  if (typeof html !== "string" || !html) return "";
  let stripped = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n");
  // Repeat until stable: removing one tag can join the pieces of another.
  let previous: string;
  do {
    previous = stripped;
    stripped = stripped.replace(/<[^>]*>/g, "");
  } while (stripped !== previous);
  const text = stripped
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    // Decoded text must not open a tag again (`&lt;script&gt;` → `‹script>`);
    // a lone `<` used as a comparison stays as it is.
    .replace(/<(?=[a-z!/?])/gi, "‹")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}… [truncated]` : text;
}
