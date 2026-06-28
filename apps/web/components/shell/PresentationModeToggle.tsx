"use client";

import { Button, Tooltip } from "@heroui/react";
import { Presentation } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePresentationMode } from "@/components/providers/PresentationModeProvider";
import { cn } from "@/lib/utils";

export function PresentationModeToggle() {
  const { isPresenting, toggle } = usePresentationMode();
  const t = useTranslations("presentationMode");

  return (
    <Tooltip content={isPresenting ? t("disable") : t("enable")} placement="bottom">
      <Button
        isIconOnly
        variant="light"
        size="sm"
        onPress={toggle}
        aria-label={isPresenting ? t("disable") : t("enable")}
        className={cn(
          "transition-colors duration-200",
          isPresenting ? "text-fichap-primary" : "text-muted hover:text-strong"
        )}
      >
        <Presentation size={16} />
      </Button>
    </Tooltip>
  );
}
