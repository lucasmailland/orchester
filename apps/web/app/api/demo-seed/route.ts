import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { seedLightweightDemo } from "@/lib/dev-seed/lightweight";

/** POST /api/demo-seed — seeds the caller's active workspace with sample data. */
export async function POST(req: Request) {
  const parsed = await parseBody(req, z.object({}));
  if (!parsed.ok) return parsed.response;
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const out = await seedLightweightDemo(ctx.workspace.id);
  return NextResponse.json(out);
}
