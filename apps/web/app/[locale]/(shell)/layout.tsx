import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

export default async function ShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="flex h-screen overflow-hidden bg-default-50 dark:bg-[#0a0a0f]">
      <Sidebar locale={locale} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar locale={locale} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
