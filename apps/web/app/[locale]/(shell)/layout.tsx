import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";

export default async function ShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const session = await getCurrentSession();

  if (!session) {
    redirect(`/${locale}/login`);
  }

  const workspaceData = await getCurrentWorkspace();

  if (!workspaceData && !session.user.onboardingCompleted) {
    redirect(`/${locale}/onboarding`);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#09090b]">
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
