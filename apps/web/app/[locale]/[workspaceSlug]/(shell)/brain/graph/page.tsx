// app/[locale]/[workspaceSlug]/(shell)/brain/graph/page.tsx
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { isEnabled } from "@/lib/feature-flags";
import { BrainGraph } from "@/components/brain/graph/BrainGraph";

export default async function BrainGraphPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const t = await getTranslations("brain.graph");
  const ctx = await getCurrentWorkspaceBySlug(workspaceSlug);
  const allow3d = ctx ? await isEnabled(ctx.workspace.id, "brain_graph_3d") : false;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Suspense
        fallback={
          <div className="flex-1 bg-[#050507] flex items-center justify-center">
            <div className="text-zinc-500 text-sm animate-pulse">{t("loading")}</div>
          </div>
        }
      >
        <BrainGraph allow3d={allow3d} />
      </Suspense>
    </div>
  );
}
