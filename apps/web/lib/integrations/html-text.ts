/**
 * Odoo stores notes and descriptions as HTML. A model reads text, and markup is
 * both noise and a way to smuggle instructions in, so tags are dropped and the
 * result is capped. This is a reader, not a sanitiser for rendering.
 */
export function htmlToText(html: unknown, maxLength = 1500): string {
  if (typeof html !== "string" || !html) return "";
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}… [truncated]` : text;
}
