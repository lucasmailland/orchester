import "server-only";
import { logWithContext } from "../observability";
import type { Aviso } from "./pause";

/**
 * Le avisa a una persona que hay algo esperando su decisión.
 *
 * Por qué existe. Una pausa que nadie ve es tan inútil como no pausar: el run
 * queda detenido y nadie se entera hasta que alguien revisa a mano. El valor de
 * una puerta humana depende por completo de que la persona sepa que está ahí.
 *
 * Nunca lanza. Si Telegram está caído, la pausa ya quedó guardada en la base y
 * el aviso se puede reenviar; si en cambio dejáramos que el error suba, un
 * canal intermitente haría fallar runs que estaban perfectamente bien.
 */
export async function avisarPausa(
  workspaceId: string,
  runId: string,
  token: string,
  mensaje: string,
  aviso: Aviso
): Promise<void> {
  const base = process.env["NEXT_PUBLIC_APP_URL"]?.replace(/\/+$/, "") ?? "";
  const enlace = base ? `${base}/aprobar/${token}` : `(falta NEXT_PUBLIC_APP_URL) token ${token}`;

  const [integrationId, action] = aviso.integrationId.split("::");
  if (!integrationId || !action) {
    logWithContext("error", "aviso de pausa mal configurado", {
      correlationId: runId,
      runId,
      integrationId: aviso.integrationId,
    });
    return;
  }

  // El texto se arma acá y no en el flow: el enlace sólo existe después de
  // generar el token, y pedirle al autor del flow que lo interpole sería
  // pedirle que conozca un dato que todavía no existía cuando lo escribió.
  const texto = `${mensaje}\n\nAprobar o rechazar: ${enlace}`;
  const input = { ...aviso.input };
  for (const campo of ["text", "message", "content", "body"]) {
    if (campo in input) {
      input[campo] = typeof input[campo] === "string" ? `${input[campo]}\n\n${texto}` : texto;
    }
  }
  // Si el flow no puso ningún campo de texto, igual mandamos algo: un aviso
  // vacío es peor que uno feo.
  if (!["text", "message", "content", "body"].some((c) => c in input)) input["text"] = texto;

  try {
    const { runIntegrationAction } = await import("../integrations/store");
    await runIntegrationAction(workspaceId, integrationId, action, input);
    logWithContext("info", "aviso de pausa enviado", {
      correlationId: runId,
      runId,
      integrationId: aviso.integrationId,
    });
  } catch (e) {
    logWithContext("error", "no pude avisar de la pausa", {
      correlationId: runId,
      runId,
      integrationId: aviso.integrationId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
