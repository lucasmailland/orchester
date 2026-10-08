"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  FLOW_GROUP_ICONS,
  GROUP_DESCRIPTION_MAX,
  GROUP_NAME_MAX,
  type FlowGroupIcon,
} from "@/lib/flows/groups";
import { iconFor } from "./nodes/icon-map";

export interface GroupMeta {
  name: string;
  description?: string | undefined;
  icon?: FlowGroupIcon | undefined;
}

/**
 * Name, one-line description and icon of a group, for creating or editing it.
 * Whoever builds the group types them; nothing is generated.
 */
export function GroupDialog({
  mode,
  stepCount,
  initial,
  onSubmit,
  onClose,
}: {
  mode: "create" | "edit";
  stepCount: number;
  initial?: GroupMeta | undefined;
  onSubmit: (meta: GroupMeta) => void;
  onClose: () => void;
}) {
  const t = useTranslations("pages.flows.groups");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState<FlowGroupIcon | undefined>(initial?.icon);
  const [touched, setTouched] = useState(false);
  const missingName = name.trim() === "";

  function submit() {
    setTouched(true);
    if (missingName) return;
    const desc = description.replace(/\s*[\r\n]+\s*/g, " ").trim();
    onSubmit({
      name: name.trim(),
      ...(desc ? { description: desc } : {}),
      ...(icon ? { icon } : {}),
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-app/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 id="group-dialog-title" className="text-sm font-semibold text-strong">
              {mode === "create" ? t("createTitle") : t("editTitle")}
            </h2>
            <p className="mt-0.5 text-xs text-muted">{t("stepsSelected", { count: stepCount })}</p>
          </div>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:bg-hover hover:text-body"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label htmlFor="group-name" className="mb-1 block text-[11px] font-medium text-body">
          {t("nameLabel")}
        </label>
        <input
          id="group-name"
          autoFocus
          value={name}
          maxLength={GROUP_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          aria-invalid={touched && missingName}
          className="w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-strong outline-none focus:border-violet-500/60"
        />
        {touched && missingName && (
          <p role="alert" className="mt-1 text-[11px] text-red-600 dark:text-red-400">
            {t("nameRequired")}
          </p>
        )}

        <label
          htmlFor="group-description"
          className="mb-1 mt-3 block text-[11px] font-medium text-body"
        >
          {t("descriptionLabel")}
        </label>
        <input
          id="group-description"
          value={description}
          maxLength={GROUP_DESCRIPTION_MAX}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("descriptionPlaceholder")}
          className="w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-strong outline-none focus:border-violet-500/60"
        />

        <p className="mb-1 mt-3 text-[11px] font-medium text-body">{t("iconLabel")}</p>
        <div role="radiogroup" aria-label={t("iconLabel")} className="flex flex-wrap gap-1">
          <button
            type="button"
            role="radio"
            aria-checked={!icon}
            onClick={() => setIcon(undefined)}
            className={
              !icon
                ? "rounded-md border border-violet-500/60 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-700 dark:text-violet-300"
                : "rounded-md border border-line px-2 py-1 text-[11px] text-muted hover:bg-hover"
            }
          >
            {t("noIcon")}
          </button>
          {FLOW_GROUP_ICONS.map((name) => {
            const Icon = iconFor(name);
            const on = icon === name;
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={name}
                title={name}
                onClick={() => setIcon(name)}
                className={
                  on
                    ? "flex h-7 w-7 items-center justify-center rounded-md border border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                    : "flex h-7 w-7 items-center justify-center rounded-md border border-line text-muted hover:bg-hover"
                }
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-body hover:bg-hover"
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400"
          >
            {mode === "create" ? t("create") : t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}
