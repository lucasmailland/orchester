"use client";
import { Handle, Position } from "@xyflow/react";
import type { LucideIcon } from "lucide-react";

interface NodeData {
  label: string;
  subtitle?: string;
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
      className="flex min-w-[180px] items-center gap-2.5 rounded-xl border border-line bg-surface/95 px-3 py-2.5 shadow-md"
      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
    >
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
