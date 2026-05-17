import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOCS, getDoc } from "@/lib/docs-content";
import { DocsLayout } from "@/components/docs/DocsLayout";

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) return { title: "Docs · Orchester" };
  return {
    title: `${doc.title} · Orchester Docs`,
    description: doc.description,
  };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();
  return <DocsLayout locale={locale} doc={doc} />;
}
