import "server-only";
import type { ImageToolOutput, ToolImagePart } from "./ai/capabilities";

export const MAX_TOOL_IMAGES = 4;
/** Hard ceiling: a tool may declare `maxImages` above the default, never above this. */
export const MAX_TOOL_IMAGES_HARD = 8;
export const MIN_TOOL_IMAGE_BYTES = 10 * 1024;
export const MAX_TOOL_IMAGE_BYTES = 1024 * 1024;
const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function isImageOutput(value: unknown): value is ImageToolOutput {
  if (!value || typeof value !== "object") return false;
  const output = value as ImageToolOutput;
  return (
    Array.isArray(output.images) ||
    (typeof output.text === "string" && Object.keys(value).every((key) => key === "text"))
  );
}

/** Validate at the model boundary too: arbitrary tools can return this shape. */
export function normalizeToolOutput(output: unknown): {
  text: string;
  images: ToolImagePart[];
  maxImages?: number;
} {
  if (!isImageOutput(output)) {
    return {
      text: typeof output === "string" ? output : JSON.stringify(output ?? null),
      images: [],
    };
  }
  const notes: string[] = [];
  const images: ToolImagePart[] = [];
  const declared = typeof output.maxImages === "number" ? Math.trunc(output.maxImages) : NaN;
  const cap = Number.isFinite(declared)
    ? Math.min(Math.max(declared, 1), MAX_TOOL_IMAGES_HARD)
    : MAX_TOOL_IMAGES;
  for (const [index, image] of (output.images ?? []).entries()) {
    const name = image?.name || `image ${index + 1}`;
    let reason: string | undefined;
    if (!image || !MEDIA_TYPES.has(image.mediaType)) reason = "unsupported MIME type";
    else if (
      typeof image.base64 !== "string" ||
      !image.base64.length ||
      image.base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)
    )
      reason = "invalid base64";
    else if (Buffer.byteLength(image.base64, "base64") > MAX_TOOL_IMAGE_BYTES)
      reason = "exceeds 1 MB";
    else if (images.length >= cap) reason = `limit of ${cap} images`;
    if (reason) notes.push(`[image omitted: ${name}, ${reason}]`);
    else images.push(image);
  }
  return {
    text: [output.text ?? "", ...notes].filter(Boolean).join("\n"),
    images,
    ...(cap > MAX_TOOL_IMAGES ? { maxImages: cap } : {}),
  };
}

/** Keep the existing trust wrapper on text; never stringify image bytes into it. */
export function mapToolOutputText(output: unknown, map: (text: string) => string): unknown {
  const normalized = normalizeToolOutput(output);
  return isImageOutput(output)
    ? { ...normalized, text: map(normalized.text) }
    : map(normalized.text);
}

/** Copy durable snapshots without changing the live evidence used by the model. */
export function redactToolImages<T>(value: T, imageSource: unknown = value): T {
  const replacements = new Map<string, string>();
  function placeholder(image: Record<string, unknown>): string {
    const kb = Math.ceil(Buffer.byteLength(image.base64 as string, "base64") / 1024);
    return `[image: ${typeof image.name === "string" ? image.name : "unnamed"}, ${kb} KB]`;
  }
  function collect(source: unknown): void {
    if (!source || typeof source !== "object") return;
    const object = source as Record<string, unknown>;
    if (typeof object.base64 === "string" && "mediaType" in object) {
      if (object.base64) replacements.set(object.base64, placeholder(object));
      return;
    }
    for (const child of Object.values(object)) collect(child);
  }
  collect(imageSource);
  if (imageSource !== value) collect(value);
  function redact(child: unknown): unknown {
    if (typeof child === "string") {
      for (const [bytes, label] of replacements) child = (child as string).split(bytes).join(label);
      return child;
    }
    if (Array.isArray(child)) return child.map(redact);
    if (!child || typeof child !== "object" || child instanceof Date) return child;
    const object = child as Record<string, unknown>;
    if (typeof object.base64 === "string" && "mediaType" in object) return placeholder(object);
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, redact(item)]));
  }
  return redact(value) as T;
}
