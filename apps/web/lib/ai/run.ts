import "server-only";
import { llmCall, llmStream, type LlmCallParams, type LlmCallResult, type LlmStreamChunk } from "../llm-call";

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

export type { LlmCallParams, LlmCallResult, LlmStreamChunk };
