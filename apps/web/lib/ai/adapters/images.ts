import "server-only";
import type { Cred, ImageParams, ImageResult, GeneratedImage } from "../capabilities";
import { fetchWithTimeout, withRetry, HttpError } from "../../http-util";

/** Timeout para el dispatch inicial de generación. */
const IMAGE_GEN_TIMEOUT_MS = 120_000;
/** Timeout para cada poll individual del estado de generación. */
const POLL_TIMEOUT_MS = 15_000;
/** Wall-clock máximo total para loops de polling (10 min). */
const POLL_DEADLINE_MS = 10 * 60_000;

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
    case "recraft":
      return openaiImages(p, cred, "https://external.api.recraft.ai/v1"); // forma OpenAI
    case "stability":
      return stabilityImages(p, cred);
    case "ideogram":
      return ideogramImages(p, cred);
    case "bfl":
      return bflImages(p, cred);
    default:
      if (family === "replicate") return replicateImages(p, cred);
      if (family === "fal") return falImages(p, cred);
      throw new Error(
        `La generación de imágenes con ${providerId} todavía no está implementada. Probá el mismo modelo vía Replicate o fal.`
      );
  }
}

async function stabilityImages(p: ImageParams, cred: Cred): Promise<ImageResult> {
  const form = new FormData();
  form.append("prompt", p.prompt);
  form.append("output_format", "png");
  const j = await withRetry(async () => {
    const r = await fetchWithTimeout(
      "https://api.stability.ai/v2beta/stable-image/generate/core",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${cred.apiKey}`, Accept: "application/json" },
        body: form,
      },
      IMAGE_GEN_TIMEOUT_MS
    );
    if (!r.ok) throw new HttpError(r.status, `Stability ${r.status}: ${await r.text()}`);
    return r.json();
  });
  return { images: j.image ? [{ url: dataUrl(j.image), mime: "image/png" }] : [], model: p.model };
}

async function ideogramImages(p: ImageParams, cred: Cred): Promise<ImageResult> {
  const form = new FormData();
  form.append("prompt", p.prompt);
  const j = await withRetry(async () => {
    const r = await fetchWithTimeout(
      "https://api.ideogram.ai/v1/ideogram-v3/generate",
      {
        method: "POST",
        headers: { "Api-Key": cred.apiKey },
        body: form,
      },
      IMAGE_GEN_TIMEOUT_MS
    );
    if (!r.ok) throw new HttpError(r.status, `Ideogram ${r.status}: ${await r.text()}`);
    return r.json();
  });
  const images: GeneratedImage[] = (j.data ?? []).map((d: { url: string }) => ({
    url: d.url,
    mime: "image/png",
  }));
  return { images, model: p.model };
}

async function bflImages(p: ImageParams, cred: Cred): Promise<ImageResult> {
  const start = await withRetry(async () => {
    const r = await fetchWithTimeout(
      `https://api.bfl.ai/v1/${p.model}`,
      {
        method: "POST",
        headers: { "x-key": cred.apiKey, "content-type": "application/json" },
        body: JSON.stringify({ prompt: p.prompt }),
      },
      IMAGE_GEN_TIMEOUT_MS
    );
    if (!r.ok) throw new HttpError(r.status, `Black Forest ${r.status}: ${await r.text()}`);
    return r.json();
  });
  const pollUrl = start.polling_url as string | undefined;
  if (!pollUrl) throw new Error("Black Forest: respuesta inesperada.");
  const deadline = Date.now() + POLL_DEADLINE_MS;
  for (let i = 0; i < 60; i++) {
    if (Date.now() > deadline)
      throw new Error("Black Forest: timeout (deadline de polling excedido).");
    await new Promise((res) => setTimeout(res, 1500));
    const pr = await fetchWithTimeout(
      pollUrl,
      { headers: { "x-key": cred.apiKey } },
      POLL_TIMEOUT_MS
    );
    const pj = await pr.json();
    if (pj.status === "Ready") {
      const url = pj.result?.sample as string | undefined;
      return { images: url ? [{ url, mime: "image/png" }] : [], model: p.model };
    }
    if (pj.status && pj.status !== "Pending" && pj.status !== "Processing") {
      throw new Error(`Black Forest: ${pj.status}`);
    }
  }
  throw new Error("Black Forest: tardó demasiado.");
}

function dataUrl(b64: string, mime = "image/png"): string {
  return `data:${mime};base64,${b64}`;
}

async function openaiImages(p: ImageParams, cred: Cred, baseURL: string): Promise<ImageResult> {
  const body: Record<string, unknown> = { model: p.model, prompt: p.prompt, n: p.n ?? 1 };
  if (p.size) body.size = p.size;
  const j = await withRetry(async () => {
    const r = await fetchWithTimeout(
      `${baseURL}/images/generations`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${cred.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      IMAGE_GEN_TIMEOUT_MS
    );
    if (!r.ok) throw new HttpError(r.status, `OpenAI imágenes ${r.status}: ${await r.text()}`);
    return r.json();
  });
  const images: GeneratedImage[] = (j.data ?? []).map((d: { url?: string; b64_json?: string }) =>
    d.url
      ? { url: d.url, mime: "image/png" }
      : { url: dataUrl(d.b64_json ?? ""), mime: "image/png" }
  );
  return { images, model: p.model };
}

async function googleImages(p: ImageParams, cred: Cred): Promise<ImageResult> {
  const key = encodeURIComponent(cred.apiKey);
  const base = "https://generativelanguage.googleapis.com/v1beta/models";
  if (p.model.startsWith("imagen")) {
    const j = await withRetry(async () => {
      const r = await fetchWithTimeout(
        `${base}/${encodeURIComponent(p.model)}:predict?key=${key}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt: p.prompt }],
            parameters: { sampleCount: p.n ?? 1 },
          }),
        },
        IMAGE_GEN_TIMEOUT_MS
      );
      if (!r.ok) throw new HttpError(r.status, `Imagen ${r.status}: ${await r.text()}`);
      return r.json();
    });
    const images: GeneratedImage[] = (j.predictions ?? []).map(
      (pr: { bytesBase64Encoded?: string; mimeType?: string }) => ({
        url: dataUrl(pr.bytesBase64Encoded ?? "", pr.mimeType ?? "image/png"),
        mime: pr.mimeType ?? "image/png",
      })
    );
    return { images, model: p.model };
  }
  // Gemini image (Nano Banana): generateContent con modalidad imagen.
  const j = await withRetry(async () => {
    const r = await fetchWithTimeout(
      `${base}/${encodeURIComponent(p.model)}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: p.prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      },
      IMAGE_GEN_TIMEOUT_MS
    );
    if (!r.ok) throw new HttpError(r.status, `Gemini imagen ${r.status}: ${await r.text()}`);
    return r.json();
  });
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
  let pred = await withRetry(async () => {
    const r = await fetchWithTimeout(
      `https://api.replicate.com/v1/models/${p.model}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cred.apiKey}`,
          "content-type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({ input: { prompt: p.prompt } }),
      },
      IMAGE_GEN_TIMEOUT_MS
    );
    if (!r.ok) throw new HttpError(r.status, `Replicate ${r.status}: ${await r.text()}`);
    return r.json();
  });
  // Si no terminó con Prefer: wait, hacemos polling acotado.
  const deadline = Date.now() + POLL_DEADLINE_MS;
  for (let i = 0; i < 60 && (pred.status === "starting" || pred.status === "processing"); i++) {
    if (Date.now() > deadline)
      throw new Error("Replicate: timeout (deadline de polling excedido).");
    await new Promise((res) => setTimeout(res, 1500));
    const pr = await fetchWithTimeout(
      pred.urls?.get ?? `https://api.replicate.com/v1/predictions/${pred.id}`,
      {
        headers: { Authorization: `Bearer ${cred.apiKey}` },
      },
      POLL_TIMEOUT_MS
    );
    pred = await pr.json();
  }
  if (pred.status !== "succeeded") throw new Error(`Replicate: ${pred.error ?? pred.status}`);
  const out = Array.isArray(pred.output) ? pred.output : [pred.output];
  const images: GeneratedImage[] = out
    .filter((u: unknown): u is string => typeof u === "string")
    .map((url: string) => ({ url, mime: "image/png" }));
  return { images, model: p.model };
}

async function falImages(p: ImageParams, cred: Cred): Promise<ImageResult> {
  const j = await withRetry(async () => {
    const r = await fetchWithTimeout(
      `https://fal.run/${p.model}`,
      {
        method: "POST",
        headers: { Authorization: `Key ${cred.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ prompt: p.prompt }),
      },
      IMAGE_GEN_TIMEOUT_MS
    );
    if (!r.ok) throw new HttpError(r.status, `fal ${r.status}: ${await r.text()}`);
    return r.json();
  });
  const images: GeneratedImage[] = (j.images ?? []).map(
    (im: { url: string; content_type?: string }) => ({
      url: im.url,
      mime: im.content_type ?? "image/png",
    })
  );
  return { images, model: p.model };
}
