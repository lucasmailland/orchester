import "server-only";
import type { Cred, ImageParams, ImageResult, GeneratedImage } from "../capabilities";

/**
 * Adaptadores de generación de imágenes, por proveedor. Devuelven URLs públicas
 * del proveedor o data: URLs (cuando vienen en base64). Sin fetch a URLs del
 * usuario (sin SSRF): sólo hosts conocidos.
 */
export async function generateImageWith(
  providerId: string,
  family: string,
  p: ImageParams,
  cred: Cred,
  baseURL?: string
): Promise<ImageResult> {
  switch (providerId) {
    case "openai":
      return openaiImages(p, cred, baseURL ?? "https://api.openai.com/v1");
    case "google":
      return googleImages(p, cred);
    case "replicate":
      return replicateImages(p, cred);
    case "fal":
      return falImages(p, cred);
    default:
      if (family === "replicate") return replicateImages(p, cred);
      if (family === "fal") return falImages(p, cred);
      throw new Error(
        `La generación de imágenes con ${providerId} todavía no está implementada. Probá el mismo modelo vía Replicate o fal.`
      );
  }
}

function dataUrl(b64: string, mime = "image/png"): string {
  return `data:${mime};base64,${b64}`;
}

async function openaiImages(p: ImageParams, cred: Cred, baseURL: string): Promise<ImageResult> {
  const body: Record<string, unknown> = { model: p.model, prompt: p.prompt, n: p.n ?? 1 };
  if (p.size) body.size = p.size;
  const r = await fetch(`${baseURL}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`OpenAI imágenes ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const images: GeneratedImage[] = (j.data ?? []).map((d: { url?: string; b64_json?: string }) =>
    d.url ? { url: d.url, mime: "image/png" } : { url: dataUrl(d.b64_json ?? ""), mime: "image/png" }
  );
  return { images, model: p.model };
}

async function googleImages(p: ImageParams, cred: Cred): Promise<ImageResult> {
  const key = encodeURIComponent(cred.apiKey);
  const base = "https://generativelanguage.googleapis.com/v1beta/models";
  if (p.model.startsWith("imagen")) {
    const r = await fetch(`${base}/${encodeURIComponent(p.model)}:predict?key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instances: [{ prompt: p.prompt }], parameters: { sampleCount: p.n ?? 1 } }),
    });
    if (!r.ok) throw new Error(`Imagen ${r.status}: ${await r.text()}`);
    const j = await r.json();
    const images: GeneratedImage[] = (j.predictions ?? []).map((pr: { bytesBase64Encoded?: string; mimeType?: string }) => ({
      url: dataUrl(pr.bytesBase64Encoded ?? "", pr.mimeType ?? "image/png"),
      mime: pr.mimeType ?? "image/png",
    }));
    return { images, model: p.model };
  }
  // Gemini image (Nano Banana): generateContent con modalidad imagen.
  const r = await fetch(`${base}/${encodeURIComponent(p.model)}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: p.prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });
  if (!r.ok) throw new Error(`Gemini imagen ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  const images: GeneratedImage[] = parts
    .filter((pt: { inlineData?: { data: string; mimeType?: string } }) => pt.inlineData?.data)
    .map((pt: { inlineData: { data: string; mimeType?: string } }) => ({
      url: dataUrl(pt.inlineData.data, pt.inlineData.mimeType ?? "image/png"),
      mime: pt.inlineData.mimeType ?? "image/png",
    }));
  return { images, model: p.model };
}

async function replicateImages(p: ImageParams, cred: Cred): Promise<ImageResult> {
  // p.model = "owner/name" (sin prefijo replicate:). Usa el endpoint por modelo.
  // Sólo `prompt`: cada modelo de Replicate valida su propio schema de input y
  // devuelve 422 ante claves desconocidas, así que no asumimos num_outputs/etc.
  const r = await fetch(`https://api.replicate.com/v1/models/${p.model}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.apiKey}`, "content-type": "application/json", Prefer: "wait" },
    body: JSON.stringify({ input: { prompt: p.prompt } }),
  });
  if (!r.ok) throw new Error(`Replicate ${r.status}: ${await r.text()}`);
  let pred = await r.json();
  // Si no terminó con Prefer: wait, hacemos polling acotado.
  for (let i = 0; i < 60 && (pred.status === "starting" || pred.status === "processing"); i++) {
    await new Promise((res) => setTimeout(res, 1500));
    const pr = await fetch(pred.urls?.get ?? `https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Bearer ${cred.apiKey}` },
    });
    pred = await pr.json();
  }
  if (pred.status !== "succeeded") throw new Error(`Replicate: ${pred.error ?? pred.status}`);
  const out = Array.isArray(pred.output) ? pred.output : [pred.output];
  const images: GeneratedImage[] = out.filter((u: unknown): u is string => typeof u === "string").map((url: string) => ({ url, mime: "image/png" }));
  return { images, model: p.model };
}

async function falImages(p: ImageParams, cred: Cred): Promise<ImageResult> {
  const r = await fetch(`https://fal.run/${p.model}`, {
    method: "POST",
    headers: { Authorization: `Key ${cred.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: p.prompt }),
  });
  if (!r.ok) throw new Error(`fal ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const images: GeneratedImage[] = (j.images ?? []).map((im: { url: string; content_type?: string }) => ({
    url: im.url,
    mime: im.content_type ?? "image/png",
  }));
  return { images, model: p.model };
}
