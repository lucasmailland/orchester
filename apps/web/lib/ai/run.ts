import "server-only";
import { llmCall, llmStream, type LlmCallParams, type LlmCallResult, type LlmStreamChunk } from "../llm-call";
import { resolveModel } from "./catalog";
import { loadCredential } from "./credentials";
import { generateImageWith } from "./adapters/images";
import { embedWith } from "./adapters/embeddings";
import { generateVideoWith, speakWith, transcribeWith } from "./adapters/media";
import { rerankWith } from "./adapters/rerank";
import type { ImageResult, EmbeddingResult, VideoResult, AudioResult, TranscriptResult, RerankResult } from "./capabilities";

/**
 * Punto de entrada unificado de IA. El resto de la app llama acá; cada función
 * resuelve el modelo en el catálogo, carga la credencial del workspace y
 * despacha al adaptador de la familia correspondiente.
 *
 * Chat ya está implementado (sobre `llm-call`, ahora catalog-driven). Imagen y
 * embeddings se agregan en sus fases (F/G) reusando este mismo patrón.
 */

export async function runChat(params: LlmCallParams): Promise<LlmCallResult> {
  return llmCall(params);
}

export function runChatStream(params: LlmCallParams): AsyncGenerator<LlmStreamChunk> {
  return llmStream(params);
}

export async function generateImage(
  workspaceId: string,
  modelId: string,
  opts: { prompt: string; size?: string; n?: number }
): Promise<ImageResult> {
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "image")
    throw new Error(`"${modelId}" no es un modelo de imagen válido.`);
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  const res = await generateImageWith(
    resolved.provider.id,
    resolved.provider.family,
    { model: resolved.model, prompt: opts.prompt, ...(opts.size ? { size: opts.size } : {}), ...(opts.n ? { n: opts.n } : {}) },
    cred,
    resolved.provider.baseURL
  );
  // Las imágenes en base64 (ej. gpt-image-1) se guardan en el storage y se
  // reemplazan por una URL corta — así no metemos megabytes en flow_runs.output.
  const { getStorage, makeKey } = await import("../storage");
  const storage = getStorage();
  res.images = await Promise.all(
    res.images.map(async (img) => {
      if (!img.url.startsWith("data:")) return img;
      const parts = /^data:([^;]+);base64,(.*)$/.exec(img.url);
      if (!parts) return img;
      const mime = parts[1] || "image/png";
      const fileExt = mime.split("/")[1] || "png";
      const key = makeKey(workspaceId, "ai-images", `image.${fileExt}`);
      await storage.put(key, Buffer.from(parts[2]!, "base64"), mime);
      return { url: storage.url(key), mime };
    })
  );
  return res;
}

export async function embed(workspaceId: string, modelId: string, input: string[]): Promise<EmbeddingResult> {
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "embedding")
    throw new Error(`"${modelId}" no es un modelo de embeddings válido.`);
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  return embedWith(resolved.provider.id, resolved.provider.family, { model: resolved.model, input }, cred, resolved.provider.baseURL);
}

export async function generateVideo(workspaceId: string, modelId: string, prompt: string): Promise<VideoResult> {
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "video") throw new Error(`"${modelId}" no es un modelo de video válido.`);
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  return generateVideoWith(resolved.provider.id, resolved.provider.family, { model: resolved.model, prompt }, cred);
}

export async function textToSpeech(workspaceId: string, modelId: string, text: string, voice?: string): Promise<AudioResult> {
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "tts") throw new Error(`"${modelId}" no es un modelo de voz válido.`);
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  const { bytes, mime } = await speakWith(resolved.provider.id, { model: resolved.model, text, ...(voice ? { voice } : {}) }, cred);
  const { getStorage, makeKey } = await import("../storage");
  const storage = getStorage();
  const key = makeKey(workspaceId, "ai-audio", "speech.mp3");
  await storage.put(key, bytes, mime);
  return { url: storage.url(key), mime, model: resolved.model };
}

export async function transcribe(workspaceId: string, modelId: string, audioUrl: string): Promise<TranscriptResult> {
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "stt") throw new Error(`"${modelId}" no es un modelo de transcripción válido.`);
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  return transcribeWith(resolved.provider.id, { model: resolved.model, audioUrl }, cred);
}

export async function rerank(workspaceId: string, modelId: string, query: string, documents: string[], topN?: number): Promise<RerankResult> {
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "rerank") throw new Error(`"${modelId}" no es un modelo de rerank válido.`);
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  return rerankWith(resolved.provider.id, { model: resolved.model, query, documents, ...(topN ? { topN } : {}) }, cred);
}

export type { LlmCallParams, LlmCallResult, LlmStreamChunk };
