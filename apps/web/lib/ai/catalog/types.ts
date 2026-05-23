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

export const CAPABILITY_LABELS: Record<
  Capability,
  { en: string; es: string; "pt-BR": string; emoji: string }
> = {
  chat: { en: "Chat / text", es: "Chat / texto", "pt-BR": "Chat / texto", emoji: "💬" },
  image: { en: "Image", es: "Imagen", "pt-BR": "Imagem", emoji: "🖼️" },
  video: { en: "Video", es: "Video", "pt-BR": "Vídeo", emoji: "🎬" },
  avatar: {
    en: "Avatar / talking person",
    es: "Avatar / persona hablando",
    "pt-BR": "Avatar / pessoa falando",
    emoji: "🎭",
  },
  embedding: {
    en: "Embeddings / vectorize",
    es: "Embeddings / vectorizar",
    "pt-BR": "Embeddings / vetorizar",
    emoji: "🔢",
  },
  rerank: { en: "Rerank", es: "Rerank", "pt-BR": "Rerank", emoji: "🔀" },
  tts: {
    en: "Voice (text → audio)",
    es: "Voz (texto → audio)",
    "pt-BR": "Voz (texto → áudio)",
    emoji: "🔊",
  },
  stt: {
    en: "Transcription (audio → text)",
    es: "Transcripción (audio → texto)",
    "pt-BR": "Transcrição (áudio → texto)",
    emoji: "🎙️",
  },
  music: { en: "Music", es: "Música", "pt-BR": "Música", emoji: "🎵" },
  ocr: { en: "OCR / documents", es: "OCR / documentos", "pt-BR": "OCR / documentos", emoji: "📄" },
};

export type CapabilityLocale = "en" | "es" | "pt-BR";

export function getCapabilityLabel(cap: Capability, locale: string): string {
  const key: CapabilityLocale = locale === "es" ? "es" : locale === "pt-BR" ? "pt-BR" : "en";
  return CAPABILITY_LABELS[cap][key];
}

/** Capacidades que ya se ejecutan en flujos. El resto es catálogo/conexión. */
export const EXECUTABLE_CAPABILITIES: Capability[] = ["chat", "image", "embedding"];
