import { redirect } from "next/navigation";
import { DOCS } from "@/lib/docs-content";

export default async function DocsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // El índice redirige al primer doc (Introducción).
  redirect(`/${locale}/docs/${DOCS[0]!.slug}`);
}
