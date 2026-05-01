"use client";
import { Bot } from "lucide-react";
import { SimpleNode } from "./SimpleNode";
import type { NodeProps } from "@xyflow/react";

export function AgentNode(p: NodeProps) {
  return (
    <SimpleNode
      data={p.data as { label: string; subtitle?: string }}
      Icon={Bot}
      accent="#8b5cf6"
    />
  );
}
