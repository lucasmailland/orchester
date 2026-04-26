import { getTranslations } from "next-intl/server";
import { Radio } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.channels" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>
      <EmptyState
        icon={<Radio size={28} />}
        title={t("empty")}
        description=""
        ctaLabel={t("emptyCta")}
        onCta={() => {}}
      />
    </div>
  );
}
