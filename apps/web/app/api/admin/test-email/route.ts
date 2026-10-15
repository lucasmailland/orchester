import { NextResponse } from "next/server";
import { z } from "zod";
import { sendEmail } from "@/lib/email";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { safeLogError } from "@/lib/safe-log";
import { escapeHtml } from "@/lib/html-escape";

const testEmailSchema = z.object({
  to: z.string().optional(),
});

const HINT = "Set RESEND_API_KEY and EMAIL_FROM; the sender domain must be verified in Resend.";

/**
 * POST /api/admin/test-email
 * Body: { to?: string }
 *
 * Manda un mail de prueba al `to` (o a tu propio email si no se pasa). Sirve
 * para verificar que Resend está configurado antes del go-live
 * sin tener que disparar el flujo de invite.
 *
 * Solo owner/admin del workspace.
 */
export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const parsed = await parseBody(req, testEmailSchema);
  if (!parsed.ok) return parsed.response;
  const to = parsed.data.to ?? ctx.user.email;
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(to)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  try {
    const result = await sendEmail({
      to,
      subject: "Orchester — Test email",
      text: `Funciona: ${new Date().toISOString()}\n\nEnviado desde el endpoint /api/admin/test-email por ${ctx.user.email}.`,
      html: `<p>Funciona: <code>${new Date().toISOString()}</code></p><p>Enviado desde el endpoint <code>/api/admin/test-email</code> por <strong>${escapeHtml(ctx.user.email)}</strong>.</p>`,
    });
    if (result.status === "not_configured") {
      return NextResponse.json(
        { ok: false, status: "not_configured", error: "Email is not configured", hint: HINT },
        { status: 503 }
      );
    }
    return NextResponse.json({ ok: true, status: result.status, to });
  } catch (e) {
    safeLogError("[test-email] failed:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        hint: HINT,
      },
      { status: 500 }
    );
  }
}
