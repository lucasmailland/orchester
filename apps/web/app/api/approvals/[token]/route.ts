import { NextResponse } from "next/server";
import { z } from "zod";
import { workspaceDelToken } from "@/lib/flows/pause";
import { mirarPorToken, retomarPorToken } from "@/lib/flows/resume";
import { logWithContext } from "@/lib/observability";
import { parseBody } from "@/lib/validation";

/**
 * La puerta humana de un flow: acá se aprueba o se rechaza lo que un
 * `wait_human` dejó esperando.
 *
 * **Por qué no pide sesión.** Se identifica por el token, no por el runId, y el
 * token viaja en el enlace que le llega a la persona — por Telegram, por
 * Discord, por mail. Quien aprueba puede no tener cuenta en orchester, igual
 * que quien dispara un webhook. Mismo modelo de confianza que
 * `/api/webhooks/[secret]`, y por eso está en la misma lista de excepciones de
 * `audit-invariants.sh`, con nombre y motivo, en vez de saltearse la regla en
 * silencio.
 *
 * **Pero sí resuelve el tenant.** No pedir sesión no es lo mismo que consultar
 * sin workspace: `workspaceDelToken` saca el workspace del propio token, y todo
 * lo que toca la base corre con ese contexto puesto. La primera versión
 * buscaba el run con un `getDb()` pelado, y con FORCE RLS esa consulta no
 * devuelve filas — toda aprobación habría contestado "este enlace no es
 * válido", sin error en ningún log.
 *
 * A cambio, el token es de un solo uso: se borra en la misma escritura que
 * registra la decisión, así que un enlace reenviado no sirve dos veces. Y se
 * busca por token y no por runId a propósito: un runId se puede adivinar, y
 * del otro lado de esta decisión puede haber un merge a producción.
 */
const decisionSchema = z.object({
  decision: z.enum(["aprobado", "rechazado"]),
  /**
   * Quién decidió. No se valida contra usuarios —el aprobador puede no tener
   * cuenta— pero queda registrado: una aprobación sin autor no se puede
   * auditar después.
   */
  quien: z.string().trim().min(1).max(200).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Un token sin workspace no se puede consultar con contexto, así que no se
  // consulta: se rechaza acá, con el mismo texto que un token inexistente.
  if (!workspaceDelToken(token)) {
    return NextResponse.json({ error: "Este enlace no es válido." }, { status: 404 });
  }

  const parsed = await parseBody(req, decisionSchema);
  if (!parsed.ok) return parsed.response;
  const { decision } = parsed.data;
  const autor = parsed.data.quien ?? "anónimo";

  const r = await retomarPorToken(token, decision, autor);

  if (!r.ok) {
    // Los dos motivos se ven igual desde afuera a propósito: así un enlace
    // filtrado no sirve para averiguar qué runs existen.
    const mensaje =
      r.motivo === "ya-resuelto" ? "Esta aprobación ya fue resuelta." : "Este enlace no es válido.";
    return NextResponse.json({ error: mensaje }, { status: 404 });
  }

  logWithContext("info", "flow run resumed by human", {
    correlationId: r.runId,
    runId: r.runId,
    decision,
    quien: autor,
  });
  return NextResponse.json({ runId: r.runId, decision, status: r.status });
}

/**
 * Qué se está por aprobar. Sin esto habría que decidir a ciegas desde un
 * mensaje de Telegram.
 *
 * Usa una función que sólo lee: la primera versión resolvía el GET llamando a
 * `retomarPorToken(token, "aprobado", …)` para espiar — un GET que aprobaba.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!workspaceDelToken(token)) {
    return NextResponse.json({ error: "Este enlace no es válido." }, { status: 404 });
  }
  const r = await mirarPorToken(token);
  if (!r.ok) return NextResponse.json({ error: "Este enlace no es válido." }, { status: 404 });
  return NextResponse.json({
    runId: r.runId,
    flowId: r.flowId,
    mensaje: r.mensaje,
    pausadoEn: r.pausadoEn,
  });
}
