"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button } from "@heroui/react";
import { Globe } from "lucide-react";
import { routing } from "@/i18n/routing";

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  "pt-BR": "Português",
  es: "Español",
};

const LOCALE_FLAGS: Record<string, string> = {
  en: "🇺🇸",
  "pt-BR": "🇧🇷",
  es: "🇪🇸",
};

export function LanguageSelector() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("shell");

  function switchLocale(newLocale: string) {
    const segments = pathname.split("/");
    segments[1] = newLocale;
    router.push(segments.join("/"));
  }

  return (
    <Dropdown>
      <DropdownTrigger>
        <Button
          variant="light"
          size="sm"
          startContent={<Globe size={14} className="shrink-0" />}
          className="text-muted hover:text-strong"
        >
          <span className="hidden sm:inline">
            {LOCALE_FLAGS[locale]} {LOCALE_LABELS[locale]}
          </span>
          <span className="sm:hidden">{LOCALE_FLAGS[locale]}</span>
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={t("selectLanguage")}
        onAction={(key) => switchLocale(String(key))}
        selectedKeys={[locale]}
        selectionMode="single"
      >
        {routing.locales.map((loc) => (
          <DropdownItem key={loc} startContent={<span>{LOCALE_FLAGS[loc]}</span>}>
            {LOCALE_LABELS[loc]}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}
