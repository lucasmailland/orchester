import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { SuspendedBanner } from "@/components/workspace/SuspendedBanner";
import { GdprExportProgress } from "@/components/workspace/GdprExportProgress";
import { getCurrentSession, getCurrentWorkspaceBySlug } from "@/lib/workspace";

/**
 * Phase D shell layout — lives under `[workspaceSlug]` so the URL
 * itself selects the tenant.
 *
 * Flow:
 *   1. Resolve session — bounce to /login if anon.
 *   2. Resolve workspace by slug AND verify membership. Anything else
 *      404s (we never tell the user a workspace exists if they can't
 *      access it).
 *   3. The lookup also sets `app.workspace_id` / `app.user_id` GUCs
 *      so every downstream query passes FORCE RLS without re-asking
 *      for the workspace.
 *
 * Server-side onboarding redirect: if the user has no membership in
 * ANY workspace (i.e. landed here with a bogus slug in the URL while
 * still onboarding), send them to onboarding. Existing members of
 * other workspaces but not this one → 404, with the switcher in the
 * topbar so they can recover.
 */
export default async function ShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;

  const session = await getCurrentSession();
  if (!session) {
    redirect(`/${locale}/login`);
  }

  const workspaceData = await getCurrentWorkspaceBySlug(workspaceSlug);

  if (!workspaceData) {
    if (!session.user.onboardingCompleted) {
      redirect(`/${locale}/onboarding`);
    }
    notFound();
  }

  const t = await getTranslations("shell");

  return (
    <div className="flex h-screen overflow-hidden bg-app">
      {/* a11y-002: skip-to-content link. Visually hidden until focused
          (Tab on page load lands here first) so keyboard users can jump
          past Sidebar + Topbar + CommandPalette controls straight into
          the page. Targets the `id="main-content"` `<main>` below. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-violet-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
      >
        {t("skipToContent")}
      </a>
      <Sidebar locale={locale} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          locale={locale}
          userName={session.user.name}
          userEmail={session.user.email}
          userImage={session.user.image ?? null}
        />
        <SuspendedBanner
          status={workspaceData.workspace.status as "active" | "suspended" | "deleted"}
          reason={workspaceData.workspace.suspendedReason}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="relative flex-1 overflow-y-auto focus:outline-none"
        >
          {/* Subtle grid + ambient glow */}
          <div className="pointer-events-none absolute inset-0 bg-grid" />
          <div className="pointer-events-none absolute inset-0 bg-ambient" />
          <div className="relative z-10 p-6">{children}</div>
        </main>
      </div>
      <CommandPalette />
      {/* Global GDPR export progress toast — survives in-app
          navigation because it's mounted at the shell layout, not at
          the route level. State lives in localStorage keyed on the
          latest job ID. */}
      <GdprExportProgress />
    </div>
  );
}
