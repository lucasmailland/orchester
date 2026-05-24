"use client";
import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { useParams } from "next/navigation";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import { WorkspaceAvatar } from "./WorkspaceAvatar";
import { useMyWorkspaces } from "./hooks/useMyWorkspaces";

/**
 * Sidebar header chip — shows the active workspace name + slug and
 * opens the switcher dropdown on click. Also installs a global ⌘K /
 * Ctrl+K shortcut that toggles the dropdown from anywhere in the app
 * (Escape closes it).
 *
 * `activeSlug` comes from the URL route segment after Phase D's
 * migration; before that param is wired (legacy URLs) it's null and
 * the chip falls back to "Select workspace".
 */
export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const params = useParams<{ workspaceSlug?: string }>();
  const activeSlug = params?.workspaceSlug ?? null;
  const { workspaces } = useMyWorkspaces();
  const active = workspaces.find((w) => w.slug === activeSlug);

  // Keyboard shortcut ⌘K / Ctrl+K
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-hover"
      >
        <WorkspaceAvatar name={active?.name ?? "?"} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-strong">
            {active?.name ?? "Select workspace"}
          </div>
          <div className="truncate text-[10px] text-faint">{active?.slug ?? ""}</div>
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>

      {open && (
        <WorkspaceMenu
          onClose={() => setOpen(false)}
          activeSlug={activeSlug}
          onCreate={() => {
            setOpen(false);
            setCreateOpen(true);
          }}
        />
      )}

      {createOpen && <CreateWorkspaceModal onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
