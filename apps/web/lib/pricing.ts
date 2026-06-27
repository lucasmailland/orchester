import "server-only";
import { MODELS } from "./ai/catalog/models";

/**
 * Fuente de verdad de pricing chat (A4): el catálogo. Construimos un índice por
 * "bare model" (la parte después de "provider:") desde los `ModelDef` que tienen
 * `costPer1kIn/Out`. Las tablas locales de abajo quedan SOLO como fallback para
 * ids legacy que no están en el catálogo (gemini-1.5-*, gpt-4-turbo, alias con
 * fecha, etc.), y de ahí al rate blended por defecto. Así, agregar un modelo con
 * precio al catálogo lo cotiza automáticamente, sin tocar este archivo.
 */
const CATALOG_CHAT_PRICE: Record<string, { in: number; out: number }> = (() => {
  const out: Record<string, { in: number; out: number }> = {};
  for (const md of MODELS) {
    if (md.capability !== "chat") continue;
    if (md.costPer1kIn == null && md.costPer1kOut == null) continue;
    const bare = md.id.slice(md.id.indexOf(":") + 1);
    out[bare] = {
      in: md.costPer1kIn ?? md.costPer1kOut ?? 0,
      out: md.costPer1kOut ?? md.costPer1kIn ?? 0,
    };
  }
  return out;
})();

/**
 * Tabla de pricing — USD por 1k tokens. Estimación blended (input+output).
 *
 * Fuente: pricing público de cada provider al 2026-05. Si tu uso real es
 * heavily skewed (ej. 90% input), reemplazá esto por una tabla que separe
 * input/output cost. Por ahora es approximation suficiente para budgeting.
 *
 * Cuando agregues un model nuevo:
 *   1. agregalo acá con el costo por 1k blended
 *   2. el dashboard + cost tracker lo toman automáticamente
 *   3. si el model no está en la tabla, fallback DEFAULT_COST_PER_1K
 */
const COST_PER_1K_USD: Record<string, number> = {
  // Anthropic
  "claude-haiku-4-5": 0.001,
  "claude-haiku-4-5-20251001": 0.001,
  "claude-sonnet-4-6": 0.008,
  "claude-opus-4-7": 0.045,

  // OpenAI
  "gpt-4o-mini": 0.0008,
  "gpt-4o": 0.005,
  "gpt-4-turbo": 0.015,

  // Google
  "gemini-1.5-flash": 0.0004,
  "gemini-1.5-pro": 0.005,
};

const DEFAULT_COST_PER_1K = 0.008;

/**
 * Tabla split input/output — USD por 1k tokens (E2-1). Más precisa que el rate
 * blended cuando el uso está sesgado (mucho input vs output). Fuente: pricing
 * público de cada provider al 2026-05.
 *
 * Si un model no está acá, `calculateChatCostUsd` cae al rate blended de
 * `COST_PER_1K_USD` (y de ahí a `DEFAULT_COST_PER_1K`), así nunca rompe.
 */
const CHAT_COST_PER_1K_USD: Record<string, { in: number; out: number }> = {
  // Anthropic
  "claude-haiku-4-5": { in: 0.0008, out: 0.004 },
  "claude-haiku-4-5-20251001": { in: 0.0008, out: 0.004 },
  "claude-sonnet-4-6": { in: 0.003, out: 0.015 },
  "claude-opus-4-7": { in: 0.015, out: 0.075 },

  // OpenAI
  "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  "gpt-4o": { in: 0.0025, out: 0.01 },
  "gpt-4-turbo": { in: 0.01, out: 0.03 },

  // Google
  "gemini-1.5-flash": { in: 0.000075, out: 0.0003 },
  "gemini-1.5-pro": { in: 0.00125, out: 0.005 },
};

/**
 * Precios aproximados por capacidad NO basada en tokens (image/video/tts/stt/
 * avatar/music/ocr). Cada entrada documenta la unidad. Son ESTIMACIONES para
 * budgeting — el costo real depende de resolución/duración/voz/etc. que no
 * siempre tenemos. Ajustar cuando haya datos reales por model.
 *
 * `unit` es informativo; `perUnit` es USD por 1 unidad de esa capacidad.
 */
const CAPABILITY_PRICE: Record<string, { unit: string; perUnit: number }> = {
  // imagen: por imagen generada
  image: { unit: "image", perUnit: 0.04 },
  // video: por segundo (aprox; sin duración real asumimos 1 unidad = 1 clip)
  video: { unit: "clip", perUnit: 0.5 },
  // tts: por 1 generación (idealmente por char; ver perChar abajo)
  tts: { unit: "request", perUnit: 0.015 },
  // stt / transcripción: por request (idealmente por minuto de audio)
  stt: { unit: "request", perUnit: 0.01 },
  // avatar / talking-head: caro, por clip
  avatar: { unit: "clip", perUnit: 1.0 },
  // música: por clip generado
  music: { unit: "clip", perUnit: 0.1 },
  // ocr: por documento/página
  ocr: { unit: "document", perUnit: 0.005 },
};

const warnedUnknownModel = new Set<string>();

/** Rate blended USD/1k para `model`: catálogo (promedio in/out) → tabla legacy → default. */
function blendedRate(model: string): number {
  const cat = CATALOG_CHAT_PRICE[model];
  if (cat) return (cat.in + cat.out) / 2;
  const legacy = COST_PER_1K_USD[model];
  if (legacy != null) return legacy;
  // COST-14: never silently bill an unknown model at the Sonnet default — warn once.
  if (!warnedUnknownModel.has(model)) {
    warnedUnknownModel.add(model);
    console.warn("[pricing] unknown model, using blended default rate:", model);
  }
  return DEFAULT_COST_PER_1K;
}

/** Costo USD para `tokens` consumidos por `model`. Usa fallback si no conoce el model. */
export function calculateCostUsd(model: string, tokens: number): number {
  const rate = blendedRate(model);
  // Math.round para evitar floats sucios; precisión 6 decimales (matching numeric(10,6))
  return Math.round((tokens / 1000) * rate * 1_000_000) / 1_000_000;
}

/**
 * Costo USD de un turno de chat separando input/output (E2-1). Si el model no
 * tiene tabla split, usa el rate blended sobre el total (in+out) — mismo
 * resultado que `calculateCostUsd(model, tokensIn + tokensOut)`.
 */
export function calculateChatCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  // Catálogo primero (A4), luego la tabla legacy, luego el rate blended.
  const split = CATALOG_CHAT_PRICE[model] ?? CHAT_COST_PER_1K_USD[model];
  if (!split) return calculateCostUsd(model, tokensIn + tokensOut);
  const usd = (tokensIn / 1000) * split.in + (tokensOut / 1000) * split.out;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

const warnedUnknownCapability = new Set<string>();

/**
 * Costo USD aproximado para una capacidad no-token (image/video/tts/stt/avatar/
 * music/ocr). `units` es la cantidad (imágenes, clips, requests, documentos…).
 * Si la capacidad no está en la tabla, devuelve 0 pero emite un warning (COST-7).
 */
export function calculateCapabilityCostUsd(capability: string, units: number): number {
  const price = CAPABILITY_PRICE[capability];
  if (!price) {
    if (!warnedUnknownCapability.has(capability)) {
      warnedUnknownCapability.add(capability);
      console.warn("[pricing] unknown capability, pricing at 0:", capability);
    }
    return 0;
  }
  return Math.round(price.perUnit * Math.max(0, units) * 1_000_000) / 1_000_000;
}

/**
 * Costo USD de embeddings — rate POR-MODELO en USD/1k tokens. Tabla pequeña; los
 * desconocidos caen al default. Importante: NO usar el rate de chat para
 * embeddings (es ~40× más caro), porque hace que el spend cap dispare temprano.
 *
 * Fuente: pricing público al 2026-05.
 */
const EMBEDDING_COST_PER_1K_USD: Record<string, number> = {
  "text-embedding-3-small": 0.00002,
  "text-embedding-3-large": 0.00013,
  "text-embedding-ada-002": 0.0001,
  "voyage-3": 0.00006,
  "voyage-3-lite": 0.00002,
  "voyage-large-2": 0.00012,
  "embed-english-v3.0": 0.0001,
  "embed-multilingual-v3.0": 0.0001,
};
const DEFAULT_EMBEDDING_COST_PER_1K = 0.00002;

export function calculateEmbeddingCostUsd(model: string, tokens: number): number {
  const rate = EMBEDDING_COST_PER_1K_USD[model] ?? DEFAULT_EMBEDDING_COST_PER_1K;
  return Math.round((tokens / 1000) * rate * 1_000_000) / 1_000_000;
}

/** Cost-per-1k para ese model (informativo, ej. mostrar al user). */
export function getCostPer1k(model: string): number {
  return blendedRate(model);
}

/** Lista de models conocidos (para UI de selección). */
export function listKnownModels(): string[] {
  return Array.from(new Set([...Object.keys(CATALOG_CHAT_PRICE), ...Object.keys(COST_PER_1K_USD)]));
}
