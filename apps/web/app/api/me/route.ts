import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";
import { parseBody } from "@/lib/validation";

const updateMeSchema = z.object({
  name: z.string().optional(),
  preferredLocale: z.enum(["en", "es", "pt"]).optional(),
  preferredTheme: z.enum(["light", "dark", "system"]).optional(),
});

/**
 * GET /api/me
 * Devuelve el user actual con sus preferencias (locale, theme).
 *
 * PATCH /api/me
 * Body: { name?, preferredLocale?, preferredTheme? }
 * Permite que el user actualice sus preferencias personales. NO toca campos
 * sensibles (email, emailVerified, password) — esos van por el flujo de auth.
 */

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
    preferredLocale: (session.user as { preferredLocale?: string }).preferredLocale ?? "en",
    preferredTheme: (session.user as { preferredTheme?: string }).preferredTheme ?? "light",
  });
}

export async function PATCH(req: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseBody(req, updateMeSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === "string" && body.name.trim()) {
    if (body.name.trim().length > 80) {
      return NextResponse.json({ error: "name too long (max 80)" }, { status: 400 });
    }
    set["name"] = body.name.trim();
  }
  if (body.preferredLocale !== undefined) {
    set["preferredLocale"] = body.preferredLocale;
  }
  if (body.preferredTheme !== undefined) {
    set["preferredTheme"] = body.preferredTheme;
  }

  // Si no hay nada para actualizar, no hagas la query.
  if (Object.keys(set).length === 1) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const db = getDb();
  const updated = await db
    .update(schema.users)
    .set(set)
    .where(eq(schema.users.id, session.user.id))
    .returning();

  return NextResponse.json({ ok: true, user: updated[0] ?? null });
}
