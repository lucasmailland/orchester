import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";

/**
 * Lee y valida el body JSON de un request contra un schema zod.
 *
 * Uso:
 *   const parsed = await parseBody(req, schema);
 *   if (!parsed.ok) return parsed.response;
 *   const { ... } = parsed.data;
 *
 * - Errores de parseo JSON → 400 "Body inválido"
 * - Errores de validación → 400 "Validación fallida" con lista compacta de issues
 * - Campos extra desconocidos se descartan (comportamiento default de zod)
 */
export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    // Empty bodies (POST with no payload, e.g. /facts/[id]/pin and the
    // other action endpoints whose schema is `z.object({})`) used to
    // throw `SyntaxError: Unexpected end of JSON input` here and
    // surface as 400 "Body inválido", breaking every Pin/Unpin/Forget/
    // Restore click from the Inspector. We treat an empty body as `{}`
    // so action routes can keep their schemas as `z.object({}).loose()`
    // without forcing every client to send `JSON.stringify({})`.
    const text = await req.text();
    raw = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Body inválido", issues: ["El cuerpo de la petición no es JSON válido"] },
        { status: 400 }
      ),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => {
      const path = i.path.length ? i.path.join(".") : "(root)";
      return `${path}: ${i.message}`;
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "Validación fallida", issues }, { status: 400 }),
    };
  }

  return { ok: true, data: result.data };
}
