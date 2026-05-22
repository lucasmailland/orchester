/**
 * Tipos del catálogo de IA — única fuente de verdad para proveedores y modelos.
 * Agregar un proveedor que encaje en una familia existente = 1 fila acá, 0 código.
 */

export type Capability =
  | "chat"
  | "image"
  | "video"
  | "avatar"
  | "embedding"
  | "rerank"
  | "tts"
  | "stt"
  | "music"
  | "ocr";

/** Familia = forma de API. Define qué adaptador maneja al proveedor. */
export type Family =
  | "openai-compatible" // chat + embeddings vía protocolo OpenAI (baseURL + key)
  | "anthropic"
  | "gemini"
  | "bedrock"
  | "replicate" // agregador
  | "fal" // agregador
  | "openai-images"
  | "google-imagen"
  | "stability"
  | "bfl"
  | "ideogram"
  | "recraft"
  | "elevenlabs"
  | "deepgram"
  | "assemblyai"
  | "bespoke"; // sin ejecutor todavía (catálogo/conexión)

export type AuthKind = "api_key" | "api_key+endpoint" | "aws";

export interface ProviderDef {
  /** id único y estable (prefijo de los model ids). */
  id: string;
  name: string;
  family: Family;
  kind: "direct" | "aggregator" | "local";
  capabilities: Capability[];
  auth: AuthKind;
  /** Para familia openai-compatible: base URL del endpoint. */
  baseURL?: string;
  docsUrl?: string;
  /** Pista corta para la UI (de dónde sacar la API key). */
  keyHint?: string;
}

export interface ModelDef {
  /** id canónico "provider:model" (ej. "openai:gpt-image-1"). */
  id: string;
  provider: string;
  name: string;
  capability: Capability;
  tier?: "fast" | "smart" | "powerful";
  /** Ventana de contexto para chat. */
  contextWindow?: number;
  /**
   * Pricing chat — USD por 1k tokens (input/output). Si están presentes, son la
   * fuente de verdad de costo (A4): `lib/pricing.ts` los lee del catálogo. Si no,
   * cae a la tabla legacy de pricing.ts y de ahí al rate blended por defecto.
   */
  costPer1kIn?: number;
  costPer1kOut?: number;
  notes?: string;
}

export const CAPABILITY_LABELS: Record<Capability, { es: string; emoji: string }> = {
  chat: { es: "Chat / texto", emoji: "💬" },
  image: { es: "Imagen", emoji: "🖼️" },
  video: { es: "Video", emoji: "🎬" },
  avatar: { es: "Avatar / persona hablando", emoji: "🎭" },
  embedding: { es: "Embeddings / vectorizar", emoji: "🔢" },
  rerank: { es: "Rerank", emoji: "🔀" },
  tts: { es: "Voz (texto → audio)", emoji: "🔊" },
  stt: { es: "Transcripción (audio → texto)", emoji: "🎙️" },
  music: { es: "Música", emoji: "🎵" },
  ocr: { es: "OCR / documentos", emoji: "📄" },
};

/** Capacidades que ya se ejecutan en flujos. El resto es catálogo/conexión. */
export const EXECUTABLE_CAPABILITIES: Capability[] = ["chat", "image", "embedding"];
