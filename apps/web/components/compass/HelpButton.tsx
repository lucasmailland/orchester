"use client";

/**
 * HelpButton — floating "?" launcher for the in-product help drawer.
 *
 * Always mounted in the shell layout. Renders a fixed-position circular
 * button bottom-right that opens the {@link HelpDrawer}. Keyboard
 * shortcut: `?` when no input is focused, or `Cmd-/` / `Ctrl-/` on any
 * focus state — mirrors GitHub / Linear conventions.
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { HelpDrawer } from "./HelpDrawer";

/** Public props for {@link HelpButton}. The component is self-contained. */
export interface HelpButtonProps {
  /** Override the bottom offset in px. Defaults to 24. */
  bottom?: number;
  /** Override the right offset in px. Defaults to 24. */
  right?: number;
}

/** Returns true if the focused element accepts text input. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function HelpButton({ bottom = 24, right = 24 }: HelpButtonProps): JSX.Element | null {
  const t = useTranslations("compass.help");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  // Global keyboard shortcuts: "?" (bare) opens, Cmd/Ctrl+"/" toggles.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "/") {
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === "?" && !meta && !e.altKey && !isEditable(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  if (!mounted) return null;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={t("openButton")}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{ bottom, right }}
        className="fixed z-50 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-strong shadow-lg ring-1 ring-black/5 transition-transform duration-150 ease-out hover:scale-105 hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:ring-white/5"
      >
        <CircleHelp className="h-5 w-5" aria-hidden="true" />
      </button>
      <HelpDrawer open={open} onClose={close} />
    </>
  );
}

export default HelpButton;
