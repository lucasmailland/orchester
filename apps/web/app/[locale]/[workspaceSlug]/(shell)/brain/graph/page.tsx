// app/[locale]/[workspaceSlug]/(shell)/brain/graph/page.tsx
import { Suspense } from "react";
import { BrainGraph } from "@/components/brain/graph/BrainGraph";

export default function BrainGraphPage() {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Suspense
        fallback={
          <div className="flex-1 bg-[#050507] flex items-center justify-center">
            <div className="text-zinc-500 text-sm animate-pulse">Loading graph…</div>
          </div>
        }
      >
        <BrainGraph />
      </Suspense>
    </div>
  );
}
