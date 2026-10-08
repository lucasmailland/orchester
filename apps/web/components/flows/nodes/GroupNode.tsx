"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Bot,
  Group as GroupIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  Ungroup,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import { NODE_ICONS } from "./icon-map";
import type { GroupViewData } from "../group-view";

/**
 * What the group block and frame can do. Provided by the builder through
 * context so the node data stays plain (and testable) data.
 */
export interface GroupActions {
  toggle: (groupId: string) => void;
  edit: (groupId: string) => void;
  ungroup: (groupId: string) => void;
}

export const GroupActionsContext = createContext<GroupActions | null>(null);

const ACCENT = "#7c3aed";

function GroupGlyph({ icon, className }: { icon?: string | undefined; className: string }) {
  const Icon = (icon && NODE_ICONS[icon]) || GroupIcon;
  return <Icon className={className} aria-hidden="true" />;
}

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="nodrag flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-strong"
    >
      {children}
    </button>
  );
}

function Status({ d }: { d: GroupViewData }) {
  const t = useTranslations("pages.flows.groups");
  if (d.status === "failed") {
    return (
      <div
        data-testid="group-status-failed"
        className="mt-1.5 flex items-center gap-1 rounded-md bg-red-500/10 px-1.5 py-1 text-[10px] font-medium text-red-600 dark:text-red-400"
      >
        <XCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{t("failedAt", { step: d.failedStep ?? "" })}</span>
      </div>
    );
  }
  if (d.status === "running") {
    return (
      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {t("runningInside")}
      </div>
    );
  }
  if (d.status === "succeeded") {
    return (
      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {t("succeededInside")}
      </div>
    );
  }
  return null;
}

function Facts({ d }: { d: GroupViewData }) {
  const t = useTranslations("pages.flows.groups");
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
      <span>{t("steps", { count: d.stepCount })}</span>
      {d.aiCount > 0 && (
        <span
          data-testid="group-ai-marker"
          className="inline-flex items-center gap-0.5 rounded-full bg-violet-600/10 px-1.5 text-violet-700 dark:text-violet-300"
        >
          <Bot className="h-2.5 w-2.5" aria-hidden="true" />
          {t("aiSteps", { count: d.aiCount })}
        </span>
      )}
      {d.issueCount > 0 && (
        <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
          {t("issuesInside", { count: d.issueCount })}
        </span>
      )}
    </span>
  );
}

/** A collapsed group: one block in place of its steps. */
export function GroupBlockNode(p: NodeProps) {
  const d = p.data as GroupViewData;
  const t = useTranslations("pages.flows.groups");
  const actions = useContext(GroupActionsContext);
  return (
    <div
      data-testid="flow-group-block"
      className="relative w-[260px] rounded-xl border border-line bg-surface/95 px-3 py-2.5 shadow-md"
      style={{
        borderLeftWidth: 3,
        borderLeftColor: ACCENT,
        boxShadow: `4px 4px 0 -1px ${ACCENT}26`,
      }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="flex items-start gap-2.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${ACCENT}1A`, color: ACCENT }}
        >
          <GroupGlyph icon={d.icon} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-strong">{d.name}</div>
          {d.description && (
            <div className="line-clamp-2 text-[10px] leading-snug text-muted">{d.description}</div>
          )}
          <div className="mt-1">
            <Facts d={d} />
          </div>
        </div>
      </div>
      <Status d={d} />
      {actions && (
        <div className="mt-1.5 flex items-center justify-end gap-0.5 border-t border-line pt-1">
          <ActionButton label={t("expand")} onClick={() => actions.toggle(d.groupId)}>
            <Maximize2 className="h-3.5 w-3.5" />
          </ActionButton>
          <ActionButton label={t("edit")} onClick={() => actions.edit(d.groupId)}>
            <Pencil className="h-3.5 w-3.5" />
          </ActionButton>
          <ActionButton label={t("ungroup")} onClick={() => actions.ungroup(d.groupId)}>
            <Ungroup className="h-3.5 w-3.5" />
          </ActionButton>
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

/** An expanded group: a frame behind its steps, with the group's header. */
export function GroupFrameNode(p: NodeProps) {
  const d = p.data as GroupViewData;
  const t = useTranslations("pages.flows.groups");
  const actions = useContext(GroupActionsContext);
  const border =
    d.status === "failed" ? "border-red-500/50" : "border-violet-500/30 dark:border-violet-400/30";
  return (
    <div
      data-testid="flow-group-frame"
      className={`h-full w-full rounded-2xl border-2 border-dashed ${border} bg-violet-500/[0.03]`}
    >
      <div className="flow-group-drag flex cursor-move items-center gap-2 px-3 py-2">
        <GroupGlyph icon={d.icon} className="h-3.5 w-3.5 shrink-0 text-violet-600" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold text-strong">{d.name}</span>
            <Facts d={d} />
          </div>
          {d.description && <div className="truncate text-[10px] text-muted">{d.description}</div>}
        </div>
        {actions && (
          <div className="flex items-center gap-0.5">
            <ActionButton label={t("collapse")} onClick={() => actions.toggle(d.groupId)}>
              <Minimize2 className="h-3.5 w-3.5" />
            </ActionButton>
            <ActionButton label={t("edit")} onClick={() => actions.edit(d.groupId)}>
              <Pencil className="h-3.5 w-3.5" />
            </ActionButton>
            <ActionButton label={t("ungroup")} onClick={() => actions.ungroup(d.groupId)}>
              <Ungroup className="h-3.5 w-3.5" />
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  );
}
