"use client";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";

export function ConditionNode({ data }: NodeProps) {
  const d = data as { label: string; subtitle?: string };
  return (
    <div
      className="relative min-w-[200px] rounded-xl border border-white/[0.08] bg-zinc-900/95 px-3 py-3 shadow-md"
      style={{ borderLeftWidth: 3, borderLeftColor: "#f59e0b" }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
          <GitBranch className="h-4 w-4" />
        </div>
        <div>
          <div className="text-xs font-medium text-zinc-100">{d.label}</div>
          {d.subtitle && <div className="text-[10px] text-zinc-500">{d.subtitle}</div>}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{ top: "30%", background: "#10b981" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        style={{ top: "70%", background: "#ef4444" }}
      />
    </div>
  );
}
