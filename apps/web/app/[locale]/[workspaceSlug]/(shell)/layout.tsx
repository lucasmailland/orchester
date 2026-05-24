import { notFound, redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { CommandPalette } from "@/components/shell/CommandPalette";
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

  return (
    <div className="flex h-screen overflow-hidden bg-app">
      <Sidebar locale={locale} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          locale={locale}
          userName={session.user.name}
          userImage={session.user.image ?? null}
        />
        <main className="relative flex-1 overflow-y-auto">
          {/* Subtle grid + ambient glow */}
          <div className="pointer-events-none absolute inset-0 bg-grid" />
          <div className="pointer-events-none absolute inset-0 bg-ambient" />
          <div className="relative z-10 p-6">{children}</div>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
