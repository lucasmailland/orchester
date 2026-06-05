"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { TeamFormModal } from "./TeamFormModal";

interface TeamsPageClientProps {
  addTeamLabel: string;
  formLabels: {
    createTitle: string;
    editTitle: string;
    nameLabel: string;
    descriptionLabel: string;
    colorLabel: string;
    save: string;
    cancel: string;
    namePlaceholder: string;
    descriptionPlaceholder: string;
  };
}

export function TeamsPageClient({ addTeamLabel, formLabels }: TeamsPageClientProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-opacity hover:opacity-90"
      >
        <Plus size={15} />
        {addTeamLabel}
      </button>

      <TeamFormModal open={open} onClose={() => setOpen(false)} labels={formLabels} />
    </>
  );
}
