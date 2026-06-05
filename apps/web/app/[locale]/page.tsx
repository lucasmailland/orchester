/**
 * Root entry point — smart redirect based on session state.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  👋  Forking Orchester?                                         │
 * │                                                                 │
 * │  This is the ideal place to add your own landing page.          │
 * │  Replace the redirect below with your custom React component    │
 * │  and you're good to go.                                         │
 * │                                                                 │
 * │  The public marketing site for Orchester itself lives at:       │
 * │  https://github.com/lucasmailland/orchester-web                 │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function RootPage({ params }: Props) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  if (session?.user) {
    redirect(`/${locale}/workspaces`);
  }

  redirect(`/${locale}/login`);
}
