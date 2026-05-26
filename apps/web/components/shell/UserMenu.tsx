"use client";

// Topbar avatar → account dropdown. Replaces the static `<Avatar>`
// that did nothing on click with a proper HeroUI Dropdown:
//   - Identity card (name, email)
//   - "Account settings" → /settings (account anchor)
//   - "Memory operations" → /settings/memory
//   - "Sign out" — calls better-auth client and bounces to /signin
//
// Kept narrow on purpose: every other shell action lives in the
// sidebar; the user menu is for ME (the operator) — my profile, my
// session.
import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Avatar,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownSection,
} from "@heroui/react";
import { LogOut, User as UserIcon, BrainCircuit, Settings as SettingsIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { signOut } from "@/lib/auth-client";
import { notify } from "@/lib/toast";

interface UserMenuProps {
  userName: string | undefined;
  userEmail: string | undefined;
  userImage: string | null | undefined;
}

export function UserMenu({ userName, userEmail, userImage }: UserMenuProps) {
  const t = useTranslations("shell");
  const router = useRouter();
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";
  const [signingOut, setSigningOut] = useState(false);

  const initials = userName
    ? userName
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      router.push(`/${locale}/signin`);
      router.refresh();
    } catch {
      notify.error(t("userMenu.signOutError"));
      setSigningOut(false);
    }
  }

  function handleAction(key: React.Key) {
    switch (key) {
      case "account":
        router.push(`/${locale}/${ws}/settings#account`);
        return;
      case "settings":
        router.push(`/${locale}/${ws}/settings`);
        return;
      case "memory":
        router.push(`/${locale}/${ws}/settings/memory`);
        return;
      case "signout":
        void handleSignOut();
        return;
    }
  }

  return (
    <Dropdown placement="bottom-end" backdrop="opaque">
      <DropdownTrigger>
        <button
          type="button"
          aria-label={t("userMenu.openLabel")}
          className="ml-2 flex items-center rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-violet-500/60"
        >
          <Avatar
            size="sm"
            name={initials}
            {...(userImage ? { src: userImage } : {})}
            classNames={{
              base: "bg-gradient-to-br from-violet-600 to-blue-600 h-7 w-7",
              name: "text-white font-semibold text-[10px]",
            }}
          />
        </button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={t("userMenu.menuLabel")}
        onAction={handleAction}
        disabledKeys={signingOut ? ["signout"] : []}
        // Narrow on purpose — operators want the menu to feel like
        // an identity card, not a kitchen sink.
        className="min-w-[240px]"
      >
        <DropdownSection
          showDivider
          aria-label={t("userMenu.identityLabel")}
          classNames={{ heading: "hidden" }}
        >
          <DropdownItem
            key="profile"
            isReadOnly
            className="h-14 cursor-default opacity-100"
            textValue={userName ?? userEmail ?? "Account"}
          >
            <div className="flex flex-col gap-0.5">
              <span className="truncate text-sm font-semibold text-strong">
                {userName ?? t("userMenu.unnamedUser")}
              </span>
              {userEmail ? (
                <span className="truncate text-[11px] text-muted">{userEmail}</span>
              ) : null}
            </div>
          </DropdownItem>
        </DropdownSection>
        <DropdownSection
          showDivider
          aria-label={t("userMenu.shortcutsLabel")}
          classNames={{ heading: "hidden" }}
        >
          <DropdownItem
            key="account"
            startContent={<UserIcon className="h-4 w-4 text-muted" aria-hidden />}
            description={userEmail ? t("userMenu.accountDescription") : undefined}
          >
            {t("userMenu.accountLabel")}
          </DropdownItem>
          <DropdownItem
            key="settings"
            startContent={<SettingsIcon className="h-4 w-4 text-muted" aria-hidden />}
            description={t("userMenu.settingsDescription")}
          >
            {t("userMenu.settingsLabel")}
          </DropdownItem>
          <DropdownItem
            key="memory"
            startContent={<BrainCircuit className="h-4 w-4 text-muted" aria-hidden />}
            description={t("userMenu.memoryDescription")}
          >
            {t("userMenu.memoryLabel")}
          </DropdownItem>
        </DropdownSection>
        <DropdownSection aria-label={t("userMenu.signOutLabel")} classNames={{ heading: "hidden" }}>
          <DropdownItem
            key="signout"
            startContent={<LogOut className="h-4 w-4" aria-hidden />}
            className="text-danger"
            color="danger"
          >
            {signingOut ? t("userMenu.signingOut") : t("userMenu.signOutLabel")}
          </DropdownItem>
        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  );
}
