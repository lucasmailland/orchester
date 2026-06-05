"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@heroui/react";

export function BrainGraphEmptyState() {
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#050507] gap-4 h-full">
      <div className="text-4xl opacity-20">🧬</div>
      <div className="text-center">
        <p className="text-zinc-300 font-semibold mb-1">No entities yet</p>
        <p className="text-zinc-500 text-sm max-w-xs leading-relaxed">
          Start conversations — your agents will build this graph automatically.
        </p>
      </div>
      <Button
        as={Link}
        href={`/${locale}/${ws}/conversations`}
        size="sm"
        className="bg-violet-700 text-white hover:bg-violet-600"
      >
        Start a conversation
      </Button>
    </div>
  );
}
