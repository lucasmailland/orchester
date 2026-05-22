/**
 * Puertos (interfaces) por capacidad. Los adaptadores implementan estos
 * contratos; el resto de la app sólo conoce estas formas.
 */

export interface Cred {
  apiKey: string;
  endpoint?: string | undefined;
  config?: Record<string, unknown> | undefined;
}

// ── Chat ───────────────────────────────────────────────────────────────────────
export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  toolResults?: Array<{ id: string; name: string; output?: unknown; error?: string }>;
}
export interface ChatTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface ChatParams {
  model: string; // id del modelo SIN prefijo de proveedor
  systemPrompt: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ChatTool[];
  baseURL?: string; // openai-compatible
}
export interface ChatResult {
  content: string;
  tokensUsed: number;
  model: string;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
}
export type ChatChunk =
  | { type: "text"; delta: string }
  | { type: "toolCall"; toolCall: { id: string; name: string; input: unknown } }
  | { type: "done"; tokensUsed: number; model: string }
  | { type: "error"; error: string };

export interface ChatAdapter {
  chat(p: ChatParams, cred: Cred): Promise<ChatResult>;
  stream(p: ChatParams, cred: Cred): AsyncGenerator<ChatChunk>;
}

// ── Imagen ───────────────────────────────────────────────────────────────────
export interface ImageParams {
  model: string;
  prompt: string;
  size?: string; // "1024x1024", "1024x1536", etc.
  n?: number;
}
export interface GeneratedImage {
  /** URL pública del proveedor, o data URL si vino en base64. */
  url: string;
  mime: string;
}
export interface ImageResult {
  images: GeneratedImage[];
  model: string;
}
export interface ImageAdapter {
  generateImage(p: ImageParams, cred: Cred): Promise<ImageResult>;
}

// ── Embeddings ─────────────────────────────────────────────────────────────────
export interface EmbeddingParams {
  model: string;
  input: string[];
}
export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  tokensUsed: number;
}
export interface EmbeddingAdapter {
  embed(p: EmbeddingParams, cred: Cred): Promise<EmbeddingResult>;
}

// Puertos futuros (fase 2): VideoAdapter, AvatarAdapter, TtsAdapter, SttAdapter,
// MusicAdapter, RerankAdapter, OcrAdapter — se declararán al implementarlos.
