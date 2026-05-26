// apps/web/app/[locale]/page.tsx
//
// Locale root. The app has no public landing — the /[locale] root only
// exists so next-intl's locale prefix middleware has something to anchor
// against. Unauthenticated users → /login. Authenticated users with at
// least one workspace → /workspaces (the picker, which forwards to the
// most-recent workspace). Both paths land within the same locale.

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function LocaleRoot({ params }: PageProps) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  if (session?.user) {
    redirect(`/${locale}/workspaces`);
  }
  redirect(`/${locale}/login`);
}
