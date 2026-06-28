import { getTranslations } from "next-intl/server";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { withWorkspaceTx } from "@/lib/tenant/context";
import { listConnectors } from "@/lib/integrations/registry";
import { listIntegrations } from "@/lib/integrations/store";
import { IntegrationsClient } from "@/components/integrations/IntegrationsClient";

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  const t = await getTranslations({ locale, namespace: "pages.integrations" });

  const ws = await getCurrentWorkspaceBySlug(workspaceSlug);
  const initialData = ws
    ? await withWorkspaceTx(ws.workspace.id, async (tx) => ({
        catalog: listConnectors(),
        configured: await listIntegrations(ws.workspace.id, tx),
      }))
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-strong">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </div>
      {initialData ? <IntegrationsClient initialData={initialData} /> : <IntegrationsClient />}
    </div>
  );
}
