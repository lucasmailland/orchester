import { redirect } from "next/navigation";

export default async function UsagePage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  redirect(`/${locale}/${workspaceSlug}`);
}
