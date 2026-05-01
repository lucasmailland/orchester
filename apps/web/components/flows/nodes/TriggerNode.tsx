"use client";
import { Play } from "lucide-react";
import { SimpleNode } from "./SimpleNode";
import type { NodeProps } from "@xyflow/react";

export function TriggerNode(p: NodeProps) {
  return (
    <SimpleNode
      data={p.data as { label: string; subtitle?: string }}
      Icon={Play}
      accent="#10b981"
      showTargetHandle={false}
    />
  );
}
