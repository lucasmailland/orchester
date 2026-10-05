import { getTranslations } from "next-intl/server";
import { workspaceDelToken } from "@/lib/flows/pause";
import { mirarPorToken } from "@/lib/flows/resume";
import { ApprovalClient } from "@/components/approvals/ApprovalClient";

/**
 * Where an approval link lands.
 *
 * `avisarPausa` sends `${APP_URL}/aprobar/${token}` to whatever channel the
 * flow named, and until now that URL 404'd: `wait_human` paused the run, the
 * person got a link, and the only way to actually decide was a POST by hand.
 *
 * **No session, on purpose.** The approver may not have an account — the link
 * arrives by Telegram, Discord or mail. The token is the credential, same
 * trust model as `/api/webhooks/[secret]`. `/aprobar` is therefore absent from
 * `PROTECTED_PATHS`, and present in `NON_WORKSPACE_TOP_LEVEL` so the
 * workspace redirect does not bounce an approver who happens to be logged in.
 *
 * Reads through `mirarPorToken` rather than fetching our own GET endpoint: it
 * is the same work without the HTTP round trip, and it is the read-only
 * function, so loading this page cannot approve anything. An earlier version
 * of the API resolved its GET by calling the resume function — a GET that
 * approved.
 */
export default async function AprobarPage({
  params,
}: {
  params: Promise<{ token: string; locale: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("approvals");

  // A token with no workspace cannot be looked up with tenant context, so it
  // is not looked up at all. Same answer as a token that does not exist: a
  // leaked link should not reveal which runs are real.
  const pausa = workspaceDelToken(token) ? await mirarPorToken(token) : { ok: false as const };

  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-6 text-zinc-100">
      {pausa.ok ? (
        <ApprovalClient
          token={token}
          pausa={{
            runId: pausa.runId,
            flowId: pausa.flowId,
            mensaje: pausa.mensaje,
            pausadoEn: pausa.pausadoEn ? pausa.pausadoEn.toISOString() : null,
          }}
        />
      ) : (
        <div className="max-w-md rounded-2xl border border-amber-500/30 bg-zinc-900/50 p-6 text-center">
          <h1 className="text-lg font-semibold text-amber-300">{t("invalidTitle")}</h1>
          <p className="mt-1.5 text-sm text-zinc-400">{t("invalidBody")}</p>
        </div>
      )}
    </div>
  );
}
