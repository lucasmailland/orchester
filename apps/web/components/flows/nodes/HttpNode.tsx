"use client";
import { Globe } from "lucide-react";
import { SimpleNode } from "./SimpleNode";
import type { NodeProps } from "@xyflow/react";

export function HttpNode(p: NodeProps) {
  return (
    <SimpleNode
      data={p.data as { label: string; subtitle?: string }}
      Icon={Globe}
      accent="#3b82f6"
    />
  );
}
