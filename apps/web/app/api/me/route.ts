import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";

/**
 * GET /api/me
 * Devuelve el user actual con sus preferencias (locale, theme).
 *
 * PATCH /api/me
 * Body: { name?, preferredLocale?, preferredTheme? }
 * Permite que el user actualice sus preferencias personales. NO toca campos
 * sensibles (email, emailVerified, password) — esos van por el flujo de auth.
 */

const ALLOWED_LOCALES = new Set(["en", "es", "pt-BR"]);
const ALLOWED_THEMES = new Set(["light", "dark", "system"]);

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

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    preferredLocale?: string;
    preferredTheme?: string;
  };

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === "string" && body.name.trim()) {
    if (body.name.trim().length > 80) {
      return NextResponse.json({ error: "name too long (max 80)" }, { status: 400 });
    }
    set["name"] = body.name.trim();
  }
  if (body.preferredLocale !== undefined) {
    if (!ALLOWED_LOCALES.has(body.preferredLocale)) {
      return NextResponse.json(
        { error: `preferredLocale must be one of ${[...ALLOWED_LOCALES].join(", ")}` },
        { status: 400 }
      );
    }
    set["preferredLocale"] = body.preferredLocale;
  }
  if (body.preferredTheme !== undefined) {
    if (!ALLOWED_THEMES.has(body.preferredTheme)) {
      return NextResponse.json(
        { error: `preferredTheme must be one of ${[...ALLOWED_THEMES].join(", ")}` },
        { status: 400 }
      );
    }
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
