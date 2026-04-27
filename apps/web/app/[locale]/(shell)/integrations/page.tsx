import { getTranslations } from "next-intl/server";
import { Plug } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.integrations" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">{t("subtitle")}</p>
      </div>
      <EmptyState
        icon={<Plug size={28} />}
        title={t("empty")}
        description=""
        ctaLabel={t("emptyCta")}
      />
    </div>
  );
}
