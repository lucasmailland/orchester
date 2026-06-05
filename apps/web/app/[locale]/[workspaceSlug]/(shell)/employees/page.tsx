import { getTranslations } from "next-intl/server";
import { EmployeeTable } from "@/components/employees/EmployeeTable";
import { getEmployees } from "@/lib/db-queries";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";

export default async function EmployeesPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  const t = await getTranslations({ locale, namespace: "pages.employees" });

  const workspace = await getCurrentWorkspaceBySlug(workspaceSlug);
  const employees = workspace ? await getEmployees(workspace.workspace.id).catch(() => []) : [];

  const labels = {
    search: t("search"),
    area: t("area"),
    email: t("email"),
    phone: t("phone"),
    active: t("active"),
    inactive: t("inactive"),
    empty: t("empty"),
    emptyCta: t("emptyCta"),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-strong">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </div>

      <EmployeeTable employees={employees} labels={labels} />
    </div>
  );
}
