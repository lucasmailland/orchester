import { getTranslations } from "next-intl/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { SettingsClient } from "@/components/settings/SettingsClient";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.settings" });

  const workspace = await getCurrentWorkspace();

  const labels = {
    title: t("title"),
    subtitle: t("subtitle"),
    workspace: t("workspace"),
    workspaceName: t("workspaceName"),
    workspaceSlug: t("workspaceSlug"),
    workspaceNamePlaceholder: t("workspaceNamePlaceholder"),
    save: t("save"),
    saved: t("saved"),
    danger: t("danger"),
    deleteWorkspace: t("deleteWorkspace"),
    deleteWarning: t("deleteWarning"),
    apiKeys: t("apiKeys"),
    apiKeysDescription: t("apiKeysDescription"),
    noApiKeys: t("noApiKeys"),
    addApiKey: t("addApiKey"),
    notifications: t("notifications"),
    notificationsDescription: t("notificationsDescription"),
    locale: t("locale"),
    localeDescription: t("localeDescription"),
    team: t("team"),
    teamDescription: t("teamDescription"),
  };

  return (
    <SettingsClient
      workspace={workspace ? { id: workspace.workspace.id, name: workspace.workspace.name, slug: workspace.workspace.slug } : null}
      labels={labels}
    />
  );
}
