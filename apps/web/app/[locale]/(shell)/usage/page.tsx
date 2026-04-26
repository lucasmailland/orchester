import { getTranslations } from "next-intl/server";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function UsagePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.usage" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>
      <EmptyState icon={<BarChart3 size={28} />} title={t("empty")} description="" />
    </div>
  );
}
