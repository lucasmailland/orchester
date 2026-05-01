import { getTranslations } from "next-intl/server";
import { OrgCanvas } from "@/components/org/OrgCanvas";

export default async function OrgPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.org" });

  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Vista en vivo de cómo equipos, agentes, flujos y personas se conectan.
        </p>
      </div>
      <OrgCanvas />
    </div>
  );
}
