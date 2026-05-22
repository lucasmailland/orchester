import "server-only";
import { getDb, schema } from "@orchester/db";
import { createId } from "@paralleldrive/cuid2";
import { llmCall, llmStream, type LlmCallParams, type LlmCallResult, type LlmStreamChunk } from "../llm-call";
import { defaultIsRetryable } from "../http-util";
import { resolveModel } from "./catalog";
import { loadCredential } from "./credentials";
import { generateImageWith } from "./adapters/images";
import { embedWith } from "./adapters/embeddings";
import { generateVideoWith, generateMusicWith, speakWith, transcribeWith } from "./adapters/media";
import { rerankWith } from "./adapters/rerank";
import { generateAvatarWith } from "./adapters/avatar";
import { ocrWith } from "./adapters/ocr";
import { calculateChatCostUsd, calculateCapabilityCostUsd } from "../pricing";
import { assertWithinSpend } from "../cost-alerts";
import { assertContentAllowed } from "../moderation";
import { safeLogError } from "../safe-log";
import type { ImageResult, EmbeddingResult, VideoResult, AudioResult, TranscriptResult, RerankResult, AvatarResult, MusicResult, OcrResult, AvatarParams } from "./capabilities";

/**
 * Punto de entrada unificado de IA. El resto de la app llama acá; cada función
 * resuelve el modelo en el catálogo, carga la credencial del workspace y
 * despacha al adaptador de la familia correspondiente.
 *
 * Chat ya está implementado (sobre `llm-call`, ahora catalog-driven). Imagen y
 * embeddings se agregan en sus fases (F/G) reusando este mismo patrón.
 */

/**
 * Metering unificado de IA (D4-1). Inserta un `usageEvent` POR despacho con el
 * `costUsd` poblado + metadata { model, capability, tokensIn, tokensOut, units }.
 * Reusa el patrón de `persistAssistantTurn` (router.ts) pero garantizando que
 * el `costUsd` quede escrito (cosa que el camino histórico omitía).
 *
 * Resiliente por diseño: un fallo de metering NO debe romper la llamada de IA
 * del usuario (try/catch + safeLogError).
 *
 * `kind` mapea a la enum `usage_event_kind`. Para chat/embeddings usamos
 * `tokens_out` (tokens consumidos); para el resto `flow_run` como genérico de
 * despacho (no hay columna capability dedicada — va en metadata).
 */
export interface RecordAiUsageArgs {
  workspaceId: string;
  capability: string;
  providerId?: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  tokensTotal?: number;
  units?: number;
  costUsd: number;
}

export async function recordAiUsage(args: RecordAiUsageArgs): Promise<void> {
  try {
    const db = getDb();
    const isToken =
      args.capability === "chat" || args.capability === "embedding";
    await db.insert(schema.usageEvents).values({
      id: createId(),
      workspaceId: args.workspaceId,
      kind: isToken ? "tokens_out" : "flow_run",
      amount: args.units ?? 1,
      costUsd: String(args.costUsd),
      metadata: {
        model: args.model,
        capability: args.capability,
        ...(args.providerId ? { providerId: args.providerId } : {}),
        ...(args.tokensIn != null ? { tokensIn: args.tokensIn } : {}),
        ...(args.tokensOut != null ? { tokensOut: args.tokensOut } : {}),
        ...(args.tokensTotal != null ? { tokensTotal: args.tokensTotal } : {}),
        ...(args.units != null ? { units: args.units } : {}),
      },
    });
  } catch (e) {
    safeLogError("[ai/run] recordAiUsage failed:", e);
  }
}

/**
 * Opciones extra de `runChat`. `fallbackModels` (C4) es una cadena OPCIONAL de
 * modelos de respaldo: si el modelo primario falla con un error retryable de
 * provider (DESPUÉS de que http-util agotó sus reintentos por-llamada), se prueba
 * el siguiente modelo de la lista. El comportamiento por defecto (sin la lista) es
 * idéntico al histórico: una sola resolución de modelo y se propaga el error.
 */
export interface RunChatOpts {
  fallbackModels?: string[];
}

export async function runChat(params: LlmCallParams, opts?: RunChatOpts): Promise<LlmCallResult> {
  await assertWithinSpend(params.workspaceId);

  const chain = [params.model, ...(opts?.fallbackModels ?? [])];
  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i]!;
    try {
      const res = await llmCall({ ...params, model });
      // `tokensUsed` es el total; sin split de provider lo tratamos como output.
      await recordAiUsage({
        workspaceId: params.workspaceId,
        capability: "chat",
        model: res.model,
        tokensOut: res.tokensUsed,
        tokensTotal: res.tokensUsed,
        costUsd: calculateChatCostUsd(res.model, 0, res.tokensUsed),
      });
      return res;
    } catch (e) {
      lastErr = e;
      const hasNext = i < chain.length - 1;
      // Sólo caemos al siguiente modelo ante un fallo transitorio/de provider.
      // Errores no-retryables (modelo inválido, provider no configurado, etc.)
      // se propagan tal cual — el fallback no los enmascara.
      if (!hasNext || !defaultIsRetryable(e)) throw e;
      safeLogError(
        `[ai/run] runChat: model "${model}" falló (retryable), probando fallback "${chain[i + 1]}":`,
        e
      );
    }
  }
  throw lastErr;
}

export function runChatStream(params: LlmCallParams): AsyncGenerator<LlmStreamChunk> {
  return llmStream(params);
}

export async function generateImage(
  workspaceId: string,
  modelId: string,
  opts: { prompt: string; size?: string; n?: number }
): Promise<ImageResult> {
  await assertWithinSpend(workspaceId);
  await assertContentAllowed({ capability: "image", text: opts.prompt });
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
  await recordAiUsage({
    workspaceId,
    capability: "image",
    providerId: resolved.provider.id,
    model: resolved.model,
    units: res.images.length,
    costUsd: calculateCapabilityCostUsd("image", res.images.length),
  });
  return res;
}

export async function embed(workspaceId: string, modelId: string, input: string[]): Promise<EmbeddingResult> {
  await assertWithinSpend(workspaceId);
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "embedding")
    throw new Error(`"${modelId}" no es un modelo de embeddings válido.`);
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  const res = await embedWith(resolved.provider.id, resolved.provider.family, { model: resolved.model, input }, cred, resolved.provider.baseURL);
  await recordAiUsage({
    workspaceId,
    capability: "embedding",
    providerId: resolved.provider.id,
    model: resolved.model,
    tokensOut: res.tokensUsed,
    tokensTotal: res.tokensUsed,
    costUsd: calculateChatCostUsd(resolved.model, 0, res.tokensUsed),
  });
  return res;
}

export async function generateVideo(workspaceId: string, modelId: string, prompt: string): Promise<VideoResult> {
  await assertWithinSpend(workspaceId);
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "video") throw new Error(`"${modelId}" no es un modelo de video válido.`);
  await assertContentAllowed({ capability: "video", text: prompt });
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  const res = await generateVideoWith(resolved.provider.id, resolved.provider.family, { model: resolved.model, prompt }, cred);
  await recordAiUsage({
    workspaceId,
    capability: "video",
    providerId: resolved.provider.id,
    model: resolved.model,
    units: 1,
    costUsd: calculateCapabilityCostUsd("video", 1),
  });
  return res;
}

export async function textToSpeech(workspaceId: string, modelId: string, text: string, voice?: string): Promise<AudioResult> {
  await assertWithinSpend(workspaceId);
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "tts") throw new Error(`"${modelId}" no es un modelo de voz válido.`);
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  const { bytes, mime } = await speakWith(resolved.provider.id, { model: resolved.model, text, ...(voice ? { voice } : {}) }, cred);
  const { getStorage, makeKey } = await import("../storage");
  const storage = getStorage();
  const key = makeKey(workspaceId, "ai-audio", "speech.mp3");
  await storage.put(key, bytes, mime);
  // Unidad: caracteres de entrada (más representativo del costo de TTS).
  await recordAiUsage({
    workspaceId,
    capability: "tts",
    providerId: resolved.provider.id,
    model: resolved.model,
    units: text.length,
    costUsd: calculateCapabilityCostUsd("tts", 1),
  });
  return { url: storage.url(key), mime, model: resolved.model };
}

export async function transcribe(workspaceId: string, modelId: string, audioUrl: string): Promise<TranscriptResult> {
  await assertWithinSpend(workspaceId);
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "stt") throw new Error(`"${modelId}" no es un modelo de transcripción válido.`);
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  const res = await transcribeWith(resolved.provider.id, { model: resolved.model, audioUrl }, cred);
  await recordAiUsage({
    workspaceId,
    capability: "stt",
    providerId: resolved.provider.id,
    model: resolved.model,
    units: 1,
    costUsd: calculateCapabilityCostUsd("stt", 1),
  });
  return res;
}

export async function rerank(workspaceId: string, modelId: string, query: string, documents: string[], topN?: number): Promise<RerankResult> {
  await assertWithinSpend(workspaceId);
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "rerank") throw new Error(`"${modelId}" no es un modelo de rerank válido.`);
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  const res = await rerankWith(resolved.provider.id, { model: resolved.model, query, documents, ...(topN ? { topN } : {}) }, cred);
  // Rerank no es token-based en nuestro pricing; medimos unidades = nº de docs.
  await recordAiUsage({
    workspaceId,
    capability: "rerank",
    providerId: resolved.provider.id,
    model: resolved.model,
    units: documents.length,
    costUsd: calculateCapabilityCostUsd("rerank", documents.length),
  });
  return res;
}

export async function generateAvatar(workspaceId: string, modelId: string, opts: Omit<AvatarParams, "model">): Promise<AvatarResult> {
  await assertWithinSpend(workspaceId);
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "avatar") throw new Error(`"${modelId}" no es un modelo de avatar válido.`);
  await assertContentAllowed({ capability: "avatar", text: opts.text, imageUrl: opts.imageUrl });
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  const res = await generateAvatarWith(resolved.provider.id, resolved.provider.family, { model: resolved.model, ...opts }, cred);
  await recordAiUsage({
    workspaceId,
    capability: "avatar",
    providerId: resolved.provider.id,
    model: resolved.model,
    units: 1,
    costUsd: calculateCapabilityCostUsd("avatar", 1),
  });
  return res;
}

export async function generateMusic(workspaceId: string, modelId: string, prompt: string): Promise<MusicResult> {
  await assertWithinSpend(workspaceId);
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "music") throw new Error(`"${modelId}" no es un modelo de música válido.`);
  await assertContentAllowed({ capability: "music", text: prompt });
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  const res = await generateMusicWith(resolved.provider.id, resolved.provider.family, { model: resolved.model, prompt }, cred);
  await recordAiUsage({
    workspaceId,
    capability: "music",
    providerId: resolved.provider.id,
    model: resolved.model,
    units: 1,
    costUsd: calculateCapabilityCostUsd("music", 1),
  });
  return res;
}

export async function ocr(workspaceId: string, modelId: string, documentUrl: string): Promise<OcrResult> {
  await assertWithinSpend(workspaceId);
  const resolved = resolveModel(modelId);
  if (!resolved || resolved.capability !== "ocr") throw new Error(`"${modelId}" no es un modelo de OCR válido.`);
  const cred = await loadCredential(workspaceId, resolved.provider.id);
  const res = await ocrWith(resolved.provider.id, { model: resolved.model, documentUrl }, cred);
  await recordAiUsage({
    workspaceId,
    capability: "ocr",
    providerId: resolved.provider.id,
    model: resolved.model,
    units: 1,
    costUsd: calculateCapabilityCostUsd("ocr", 1),
  });
  return res;
}

export type { LlmCallParams, LlmCallResult, LlmStreamChunk };
