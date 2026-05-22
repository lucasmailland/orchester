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

// ── Video ───────────────────────────────────────────────────────────────────
export interface VideoParams {
  model: string;
  prompt: string;
}
export interface VideoResult {
  url: string;
  model: string;
}
export interface VideoAdapter {
  generateVideo(p: VideoParams, cred: Cred): Promise<VideoResult>;
}

// ── Voz (TTS) ────────────────────────────────────────────────────────────────
export interface TtsParams {
  model: string;
  text: string;
  voice?: string;
}
export interface AudioResult {
  url: string;
  mime: string;
  model: string;
}
export interface TtsAdapter {
  speak(p: TtsParams, cred: Cred): Promise<AudioResult>;
}

// ── Transcripción (STT) ──────────────────────────────────────────────────────
export interface SttParams {
  model: string;
  audioUrl: string;
}
export interface TranscriptResult {
  text: string;
  model: string;
}
export interface SttAdapter {
  transcribe(p: SttParams, cred: Cred): Promise<TranscriptResult>;
}

// ── Rerank ───────────────────────────────────────────────────────────────────
export interface RerankParams {
  model: string;
  query: string;
  documents: string[];
  topN?: number;
}
export interface RerankHit {
  index: number;
  document: string;
  score: number;
}
export interface RerankResult {
  results: RerankHit[];
  model: string;
}
export interface RerankAdapter {
  rerank(p: RerankParams, cred: Cred): Promise<RerankResult>;
}

// Puertos futuros (fase 2): AvatarAdapter, MusicAdapter, OcrAdapter.
