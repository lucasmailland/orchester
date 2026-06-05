"use client";

/**
 * CommandBarRoot — client wrapper that owns the open/closed state of
 * the Compass {@link CommandBar} and binds the global Cmd-K / Ctrl-K
 * shortcut.
 *
 * Mounted once at the shell layout (alongside HelpButton, TourProvider).
 * Marketing routes do NOT mount this — public pages have no command bar.
 *
 * Behaviour:
 *   - Cmd-K on macOS, Ctrl-K elsewhere. Toggles: pressing again closes.
 *   - Skipped when the user is typing in an input, textarea, select, or
 *     contenteditable element — we never steal the keystroke from a real
 *     editor.
 *   - Also responds to a programmatic `compass:command-bar` window event
 *     so other surfaces (e.g. the help drawer) can suggest "press Cmd-K"
 *     and the suggestion link can open the bar directly.
 *   - SSR safe: all listeners attach inside `useEffect`.
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { CommandBar } from "./CommandBar";

/** True if `target` is a real text-input surface that owns its keystrokes. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof window === "undefined") return false;
  const el =
    target instanceof HTMLElement
      ? target
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

/** Detect macOS once. SSR-safe (returns false on the server). */
function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  // `navigator.platform` is deprecated but still the most reliable signal
  // for Cmd vs Ctrl across browsers. `userAgentData.platform` would be
  // strictly better but isn't yet universal.
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || "");
}

export function CommandBarRoot(): JSX.Element {
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  // ── Global keyboard handler ──
  useEffect(() => {
    const mac = isMacPlatform();
    function onKeyDown(e: KeyboardEvent) {
      // Ignore Cmd-K when the user is typing somewhere editable — we
      // must not hijack the keystroke from real inputs.
      if (e.key.toLowerCase() !== "k") return;
      const mod = mac ? e.metaKey : e.ctrlKey;
      if (!mod || e.shiftKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      setOpen((v) => !v);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Programmatic open via custom event ──
  useEffect(() => {
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("compass:command-bar", onOpenEvent);
    return () => window.removeEventListener("compass:command-bar", onOpenEvent);
  }, []);

  return <CommandBar open={open} onOpenChange={handleOpenChange} />;
}

export default CommandBarRoot;
