/**
 * Screenshots pasted into an Odoo task description are stored as ir.attachment
 * rows and referenced from the HTML as `<img src="/web/image/<id>...">`. When
 * a task is cloned or its description forwarded, the rows keep belonging to
 * the original record, so listing a task's own attachments misses them.
 *
 * This module only extracts candidate ids from HTML. Nothing here authorises
 * a read: the caller must check each row (mimetype, model) before using it.
 */

export const EMBEDDED_IMAGE_CAP = 20;

// A single tag longer than this is not a pasted screenshot.
const MAX_TAG_CHARS = 4096;
const SRC_ATTR = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/i;
const ATTACHMENT_PATH = /^\/web\/(?:image|content)\/(\d{1,12})(?=$|[-/?#&])/;

/**
 * Attachment ids referenced by `<img>` tags, in document order, deduplicated
 * and capped. Only same-origin `/web/image/<id>` and `/web/content/<id>`
 * paths count. Linear: one forward scan, bounded work per tag.
 */
export function extractEmbeddedAttachmentIds(html: unknown, cap = EMBEDDED_IMAGE_CAP): number[] {
  if (typeof html !== "string" || !html || cap <= 0) return [];
  const lower = html.toLowerCase();
  const ids: number[] = [];
  const seen = new Set<number>();
  let pos = 0;
  while (ids.length < cap) {
    const start = lower.indexOf("<img", pos);
    if (start === -1) break;
    const next = html.charCodeAt(start + 4);
    // `<imgx` is not an image tag; `<img>`, `<img ` and `<img/` are.
    const isTag = Number.isNaN(next) || next === 62 || next === 47 || /\s/.test(html[start + 4]!);
    const close = html.indexOf(">", start + 4);
    const end = close === -1 ? html.length : close;
    pos = start + 4;
    if (!isTag) continue;
    // No `>` anywhere ahead: nothing after this can be a complete tag.
    if (close === -1) break;
    const tag = html.slice(start + 4, Math.min(end, start + 4 + MAX_TAG_CHARS));
    const m = SRC_ATTR.exec(tag);
    if (!m) continue;
    const src = (m[1] ?? m[2] ?? m[3] ?? "").trim().replace(/&amp;/gi, "&");
    const id = ATTACHMENT_PATH.exec(src)?.[1];
    if (id === undefined) continue;
    const n = Number(id);
    if (!Number.isSafeInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    ids.push(n);
  }
  return ids;
}
