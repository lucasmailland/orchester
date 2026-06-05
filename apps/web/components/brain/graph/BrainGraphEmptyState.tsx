"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";

export function BrainGraphEmptyState() {
  const t = useTranslations("brain.graph");
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#050507] gap-4 h-full">
      <div className="text-4xl opacity-20">🧬</div>
      <div className="text-center">
        <p className="text-zinc-300 font-semibold mb-1">{t("emptyTitle")}</p>
        <p className="text-zinc-500 text-sm max-w-xs leading-relaxed">{t("emptyDesc")}</p>
      </div>
      <Button
        as={Link}
        href={`/${locale}/${ws}/conversations`}
        size="sm"
        className="bg-violet-700 text-white hover:bg-violet-600"
      >
        {t("emptyCta")}
      </Button>
    </div>
  );
}
