"use client";
import { Handle, Position } from "@xyflow/react";
import { Bot, User, type LucideIcon } from "lucide-react";

interface NodeData {
  label: string;
  subtitle?: string | undefined;
  badge?: string | null | undefined;
  /** Design-time nature of the step; only `ai` and `human` get a mark. */
  nature?: "ai" | "code" | "human" | "control" | undefined;
  natureLabel?: string | undefined;
}

export function SimpleNode({
  data,
  Icon,
  accent,
  showSourceHandle = true,
  showTargetHandle = true,
}: {
  data: NodeData;
  Icon: LucideIcon;
  accent: string;
  showSourceHandle?: boolean;
  showTargetHandle?: boolean;
}) {
  return (
    <div
      className="relative flex min-w-[180px] items-center gap-2.5 rounded-xl border border-line bg-surface/95 px-3 py-2.5 shadow-md"
      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
    >
      {data.badge && (
        <div
          className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white shadow"
          title={data.badge}
        >
          !
        </div>
      )}
      {(data.nature === "ai" || data.nature === "human") && (
        <div
          data-testid={`nature-badge-${data.nature}`}
          title={data.natureLabel}
          aria-label={data.natureLabel}
          className={
            data.nature === "ai"
              ? "absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white shadow"
              : "absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-white shadow"
          }
        >
          {data.nature === "ai" ? (
            <Bot className="h-3 w-3" aria-hidden="true" />
          ) : (
            <User className="h-3 w-3" aria-hidden="true" />
          )}
        </div>
      )}
      {showTargetHandle && <Handle type="target" position={Position.Left} />}
      <div
        className="flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: `${accent}1A`, color: accent }}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-xs font-medium text-strong">{data.label}</div>
        {data.subtitle && <div className="text-[10px] text-muted">{data.subtitle}</div>}
      </div>
      {showSourceHandle && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
