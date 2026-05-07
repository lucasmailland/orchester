import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { safeLogError } from "@/lib/safe-log";

/**
 * POST /api/admin/test-email
 * Body: { to?: string }
 *
 * Manda un mail de prueba al `to` (o a tu propio email si no se pasa). Sirve
 * para verificar que el SMTP / Resend está configurado antes del go-live
 * sin tener que disparar el flujo de invite.
 *
 * Solo owner/admin del workspace.
 */
export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const body = (await req.json().catch(() => ({}))) as { to?: string };
  const to = body.to ?? ctx.user.email;
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(to)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  try {
    await sendEmail({
      to,
      subject: "Orchester — Test email",
      text: `Funciona: ${new Date().toISOString()}\n\nEnviado desde el endpoint /api/admin/test-email por ${ctx.user.email}.`,
      html: `<p>Funciona: <code>${new Date().toISOString()}</code></p><p>Enviado desde el endpoint <code>/api/admin/test-email</code> por <strong>${ctx.user.email}</strong>.</p>`,
    });
    return NextResponse.json({ ok: true, to });
  } catch (e) {
    safeLogError("[test-email] failed:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        hint: "Si el log dice 'RESEND_API_KEY not set', configurá las env vars MAIL_DRIVER + SMTP_* o RESEND_API_KEY.",
      },
      { status: 500 }
    );
  }
}
