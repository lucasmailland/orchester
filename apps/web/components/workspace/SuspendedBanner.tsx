// apps/web/components/workspace/SuspendedBanner.tsx
//
// Sticky red banner shown at the top of every shell page when the
// active workspace is in `status='suspended'`. Read-only — the
// workspace is locked at the API layer too, this is purely
// informational + recovery affordance.
//
// Renders nothing for non-suspended workspaces so the shell layout can
// mount it unconditionally.
//
// Server Component — no client behaviour, just translation + JSX. Keeps
// next-intl client runtime out of the per-route bundle for the common
// case (active workspaces) where the component returns null anyway.
import { AlertOctagon } from "lucide-react";
import { getTranslations } from "next-intl/server";

interface Props {
  status: "active" | "suspended" | "deleted";
  reason?: string | null;
}

export async function SuspendedBanner({ status, reason }: Props) {
  if (status !== "suspended") return null;
  const t = await getTranslations("workspace.suspended");

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-30 flex items-center gap-3 border-b border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-700 dark:text-red-300"
    >
      <AlertOctagon className="h-4 w-4 shrink-0" />
      <div className="flex-1">
        <p className="font-semibold">{t("title")}</p>
        <p className="text-[11px] opacity-90">{t("body")}</p>
        {reason ? <p className="text-[11px] opacity-75">{t("reason", { reason })}</p> : null}
      </div>
      <a
        href="mailto:support@orchester.app"
        className="rounded-md border border-red-500/40 px-2.5 py-1 text-[11px] font-medium hover:bg-red-500/10"
      >
        {t("contactSupport")}
      </a>
    </div>
  );
}
