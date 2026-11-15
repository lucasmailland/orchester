"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Modal, ModalContent, ModalHeader, ModalBody } from "@heroui/react";
import { useTranslations } from "next-intl";
import { TEMPLATES, type AgentTemplate } from "./templates";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (t: AgentTemplate) => void;
}

const CATEGORIES = [
  "All",
  "Sales",
  "Support",
  "HR",
  "IT",
  "Legal",
  "Finance",
  "Operations",
] as const;

export function TemplatePickerModal({ open, onClose, onPick }: Props) {
  const t = useTranslations("pages.agents.studio.templates");
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("All");
  const filtered = cat === "All" ? TEMPLATES : TEMPLATES.filter((tpl) => tpl.category === cat);

  return (
    <Modal
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      placement="center"
      backdrop="blur"
      size="3xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex items-center gap-2.5 border-b border-line px-5 py-4 text-sm font-medium text-strong">
              <BookOpen className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              {t("title")}
            </ModalHeader>

            <div className="flex gap-1.5 overflow-x-auto border-b border-line px-5 py-2.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCat(c)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs",
                    cat === c
                      ? "bg-violet-500/20 text-violet-700 dark:text-violet-300"
                      : "text-muted hover:text-body"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>

            <ModalBody className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
              {filtered.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    onPick(tpl);
                    onClose();
                  }}
                  className="rounded-xl border border-line bg-card p-3.5 text-left hover:border-violet-500/40 hover:bg-card"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-violet-700 dark:text-violet-300">
                      {tpl.category}
                    </span>
                    <span className="text-sm font-medium text-strong">{tpl.name}</span>
                  </div>
                  <p className="text-xs text-muted">{tpl.description}</p>
                </button>
              ))}
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
