import "server-only";
import { fetchWithTimeout } from "./http-util";
import { safeLogError } from "./safe-log";

/**
 * Moderación de contenido para generación de medios (F3).
 *
 * Tres capas, de barata a cara:
 *  1. Denylist de texto (siempre): bloquea categorías inequívocamente abusivas.
 *  2. Gate de "cara/persona" (deepfake): la generación de avatares/video a partir
 *     de la imagen de una persona está deshabilitada por defecto — es el vector
 *     de abuso más alto (impersonación, "avatar diciendo un nombre"). Se habilita
 *     explícitamente con ALLOW_FACE_GENERATION=1 cuando el operador asume la
 *     responsabilidad de consentimiento.
 *  3. API de moderación opcional (opt-in MODERATION_API=1 + OPENAI_API_KEY):
 *     clasifica el prompt y bloquea si viene flaggeado.
 *
 * Escape hatch global: MODERATION_DISABLED=1 (no recomendado en multi-tenant).
 */

export class ModerationError extends Error {
  status = 422;
  constructor(message: string) {
    super(message);
    this.name = "ModerationError";
  }
}

// Términos inequívocamente prohibidos (abuso sexual infantil, etc.). Lista
// mínima y conservadora; la API de moderación cubre el resto de matices.
const HARD_DENYLIST = [
  "child sexual",
  "csam",
  "child porn",
  "underage sex",
  "minor nude",
  "bestiality",
];

function textTripsDenylist(text: string): string | null {
  const t = text.toLowerCase();
  for (const term of HARD_DENYLIST) {
    if (t.includes(term)) return term;
  }
  return null;
}

export interface ModerationInput {
  capability: "image" | "video" | "avatar" | "music" | "tts";
  /** Prompt / texto a generar. */
  text?: string | undefined;
  /** URL de imagen de origen (avatares/video con cara de persona). */
  imageUrl?: string | undefined;
}

/**
 * Lanza ModerationError si el contenido no está permitido. No bloquea por
 * fallos de red de la API de moderación (fail-open en ESE paso para no romper
 * la generación legítima), pero las capas 1 y 2 siempre aplican.
 */
export async function assertContentAllowed(input: ModerationInput): Promise<void> {
  if (process.env.MODERATION_DISABLED === "1") return;

  const text = (input.text ?? "").trim();

  // Capa 1: denylist dura (siempre).
  if (text) {
    const hit = textTripsDenylist(text);
    if (hit) {
      throw new ModerationError(
        "El contenido solicitado infringe nuestra política de uso y no puede generarse."
      );
    }
  }

  // Capa 2: gate de cara/persona (deepfake) para avatar/video con imagen origen.
  const usesPersonImage =
    !!input.imageUrl && (input.capability === "avatar" || input.capability === "video");
  const avatarFromText = input.capability === "avatar"; // talking-head siempre es de una persona
  if ((usesPersonImage || avatarFromText) && process.env.ALLOW_FACE_GENERATION !== "1") {
    throw new ModerationError(
      "La generación de avatares/videos con la imagen de una persona está deshabilitada por seguridad " +
        "(riesgo de impersonación/deepfake). Un administrador debe habilitar ALLOW_FACE_GENERATION=1 y " +
        "garantizar el consentimiento de la persona representada."
    );
  }

  // Capa 3: API de moderación opcional sobre el prompt.
  if (text && process.env.MODERATION_API === "1" && process.env.OPENAI_API_KEY) {
    try {
      const r = await fetchWithTimeout(
        "https://api.openai.com/v1/moderations",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
        },
        15_000
      );
      if (r.ok) {
        const j = (await r.json()) as { results?: Array<{ flagged?: boolean }> };
        if (j.results?.[0]?.flagged) {
          throw new ModerationError(
            "El contenido solicitado fue marcado por moderación y no puede generarse."
          );
        }
      }
    } catch (e) {
      if (e instanceof ModerationError) throw e;
      // Fallo de red/timeout de la API → no bloqueamos (las capas 1-2 ya aplicaron).
      safeLogError("[moderation] API check failed (fail-open):", e);
    }
  }
}
