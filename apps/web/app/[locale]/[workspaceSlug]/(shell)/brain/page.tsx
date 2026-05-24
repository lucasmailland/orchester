// /[locale]/[workspaceSlug]/brain — full Brain Core page (Stats + Panel)
import { BrainStats } from "@/components/brain/BrainStats";
import { BrainPanel } from "@/components/brain/BrainPanel";

export default function BrainPage() {
  return (
    <div className="space-y-8 p-6">
      <BrainStats />
      <BrainPanel />
    </div>
  );
}
