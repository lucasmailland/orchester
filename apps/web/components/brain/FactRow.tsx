"use client";

import { useRouter, useParams } from "next/navigation";
import { Pin, MoreHorizontal, Trash2, RotateCcw, BookOpen, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Button,
  Chip,
  Tooltip,
} from "@heroui/react";
import { cn } from "@/lib/utils";
import type { Fact } from "@/lib/hooks/use-brain-facts";

const KIND_COLORS: Record<string, string> = {
  preference: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  trait: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  event: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  relationship: "bg-pink-500/15 text-pink-600 dark:text-pink-300",
  skill: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  concern: "bg-red-500/15 text-red-600 dark:text-red-300",
  other: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};

const SCOPE_LABEL_COLOR: Record<string, string> = {
  global: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  conversation: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  employee: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  team: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour}h`;
  const day = Math.round(hour / 24);
  if (day < 7) return `${day}d`;
  const week = Math.round(day / 7);
  if (week < 4) return `${week}w`;
  const month = Math.round(day / 30);
  if (month < 12) return `${month}mo`;
  const year = Math.round(day / 365);
  return `${year}y`;
}

export interface FactRowProps {
  fact: Fact;
  onPinToggle: (fact: Fact) => void;
  onForget: (fact: Fact) => void;
  onRestore: (fact: Fact) => void;
  onViewCitations: (fact: Fact) => void;
  onEdit?: (fact: Fact) => void;
}

export function FactRow({
  fact,
  onPinToggle,
  onForget,
  onRestore,
  onViewCitations,
  onEdit,
}: FactRowProps) {
  const t = useTranslations("brain");
  const router = useRouter();
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";

  const openDetail = () => {
    router.push(`/${locale}/${ws}/brain/${fact.id}`);
  };

  const confidencePct = Math.round((fact.confidence ?? 0) * 100);
  const forgotten = fact.status === "forgotten";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-no-row-click]")) return;
        openDetail();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") openDetail();
      }}
      className={cn(
        "group flex items-center gap-4 rounded-xl border bg-card p-4 transition-all",
        "cursor-pointer hover:border-violet-500/40 hover:bg-hover",
        fact.pinned ? "border-violet-500/30" : "border-line",
        forgotten && "opacity-60"
      )}
    >
      {/* Pin */}
      <div className="flex w-6 shrink-0 justify-center">
        {fact.pinned ? (
          <Tooltip content={t("actions.pinned")} placement="right">
            <Pin className="h-4 w-4 text-violet-500" fill="currentColor" />
          </Tooltip>
        ) : (
          <span className="h-4 w-4" />
        )}
      </div>

      {/* Subject + statement */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="truncate font-semibold text-strong" title={fact.subject}>
            {fact.subject}
          </span>
          <Chip
            size="sm"
            variant="flat"
            className={cn(
              "h-5 text-[10px] uppercase tracking-wider",
              KIND_COLORS[fact.kind] ?? KIND_COLORS.other
            )}
          >
            {fact.kind}
          </Chip>
          <Chip
            size="sm"
            variant="flat"
            className={cn(
              "h-5 text-[10px] uppercase tracking-wider",
              SCOPE_LABEL_COLOR[fact.scope] ?? SCOPE_LABEL_COLOR.global
            )}
          >
            {fact.scope}
          </Chip>
          {forgotten && (
            <Chip
              size="sm"
              variant="flat"
              className="h-5 bg-zinc-500/15 text-[10px] uppercase text-muted"
            >
              {t("filters.statusForgotten")}
            </Chip>
          )}
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm text-body" title={fact.statement}>
          {fact.statement}
        </p>
      </div>

      {/* Confidence bar */}
      <div className="hidden w-28 shrink-0 md:block">
        <div className="flex items-center justify-between text-[10px] text-muted">
          <span className="font-mono">{confidencePct}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500"
            style={{ width: `${confidencePct}%` }}
          />
        </div>
      </div>

      {/* Hit count */}
      <div
        className="hidden w-14 shrink-0 text-right text-xs text-muted md:block"
        title={t("detail.recalledNTimes", { count: fact.hitCount })}
      >
        <span className="font-mono">{fact.hitCount}</span>
      </div>

      {/* Updated */}
      <div
        className="hidden w-12 shrink-0 text-right text-[11px] text-faint md:block"
        title={fact.updatedAt}
      >
        {relativeTime(fact.updatedAt)}
      </div>

      {/* Actions */}
      <div data-no-row-click className="flex shrink-0 items-center">
        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <Button
              isIconOnly
              size="sm"
              variant="light"
              aria-label={t("actions.menu")}
              className="text-muted"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownTrigger>
          <DropdownMenu aria-label={t("actions.menu")}>
            {onEdit ? (
              <DropdownItem
                key="edit"
                startContent={<Pencil className="h-3.5 w-3.5" />}
                onPress={() => onEdit(fact)}
              >
                {t("actions.edit")}
              </DropdownItem>
            ) : null}
            <DropdownItem
              key="pin"
              startContent={<Pin className="h-3.5 w-3.5" />}
              onPress={() => onPinToggle(fact)}
            >
              {fact.pinned ? t("actions.unpin") : t("actions.pin")}
            </DropdownItem>
            <DropdownItem
              key="citations"
              startContent={<BookOpen className="h-3.5 w-3.5" />}
              onPress={() => onViewCitations(fact)}
            >
              {t("actions.viewCitations")}
            </DropdownItem>
            {forgotten ? (
              <DropdownItem
                key="restore"
                startContent={<RotateCcw className="h-3.5 w-3.5" />}
                onPress={() => onRestore(fact)}
                className="text-emerald-500"
              >
                {t("actions.restore")}
              </DropdownItem>
            ) : (
              <DropdownItem
                key="forget"
                startContent={<Trash2 className="h-3.5 w-3.5" />}
                onPress={() => onForget(fact)}
                className="text-danger"
                color="danger"
              >
                {t("actions.forget")}
              </DropdownItem>
            )}
          </DropdownMenu>
        </Dropdown>
      </div>
    </div>
  );
}
