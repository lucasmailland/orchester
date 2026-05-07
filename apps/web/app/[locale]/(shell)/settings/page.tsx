import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";
import { SettingsClient } from "@/components/settings/SettingsClient";
import { getTranslations } from "next-intl/server";
import { isStripeEnabled } from "@/lib/billing/stripe";

/**
 * /[locale]/settings — pantalla de configuración del workspace + cuenta.
 *
 * Hidrata el cliente con todos los datos críticos en SSR para que la primera
 * pintura ya tenga el name del workspace, role del caller, y locale/theme del
 * user. Las prefs de notificación se cargan en el cliente porque cambian con
 * cada toggle y no vale la pena prefetch.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.settings" });

  const session = await getCurrentSession();
  const workspaceCtx = await getCurrentWorkspace();
  const workspace = workspaceCtx?.workspace ?? null;
  const role = workspaceCtx?.role ?? null;

  const me = session
    ? {
        id: session.user.id,
        name: session.user.name ?? "",
        email: session.user.email,
        preferredLocale:
          (session.user as { preferredLocale?: string | null }).preferredLocale ?? "en",
        preferredTheme:
          (session.user as { preferredTheme?: string | null }).preferredTheme ?? "light",
      }
    : null;

  return (
    <SettingsClient
      workspace={
        workspace
          ? {
              id: workspace.id,
              name: workspace.name,
              slug: workspace.slug,
              timezone: workspace.timezone,
              role: role ?? "viewer",
            }
          : null
      }
      me={me}
      stripeEnabled={isStripeEnabled()}
      labels={{
        title: t("title"),
        subtitle: t("subtitle"),
      }}
    />
  );
}
