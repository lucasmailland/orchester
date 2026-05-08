import "server-only";

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

/** Costo USD para `tokens` consumidos por `model`. Usa fallback si no conoce el model. */
export function calculateCostUsd(model: string, tokens: number): number {
  const rate = COST_PER_1K_USD[model] ?? DEFAULT_COST_PER_1K;
  // Math.round para evitar floats sucios; precisión 6 decimales (matching numeric(10,6))
  return Math.round((tokens / 1000) * rate * 1_000_000) / 1_000_000;
}

/** Cost-per-1k para ese model (informativo, ej. mostrar al user). */
export function getCostPer1k(model: string): number {
  return COST_PER_1K_USD[model] ?? DEFAULT_COST_PER_1K;
}

/** Lista de models conocidos (para UI de selección). */
export function listKnownModels(): string[] {
  return Object.keys(COST_PER_1K_USD);
}
