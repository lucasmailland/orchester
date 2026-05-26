"use client";

import { useCallback, useEffect, useState } from "react";
import { Switch } from "@heroui/react";
import { ShieldOff } from "lucide-react";
import { useTranslations } from "next-intl";

interface Props {
  conversationId: string;
  /** Optional initial value sourced from the server (when wired in v1.4). */
  initialValue?: boolean;
  /** Show the inline "learning paused" banner under the toggle when ON. */
  showBanner?: boolean;
  /**
   * v1.6 G1-2: server-side persistence wiring. When provided, the toggle
   * hits the PATCH endpoint instead of localStorage and surfaces an error
   * toast on failure (rolling back the optimistic UI). If omitted, falls
   * back to the legacy localStorage path so existing callers keep working.
   */
  serverPersist?: {
    paused: boolean;
    onToggle: (next: boolean) => Promise<void>;
  };
}

const STORAGE_KEY = "mnemo:sensitivity-pauses";

function readMap(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, boolean>;
    return {};
  } catch {
    return {};
  }
}

function writeMap(next: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota exceeded — silently drop. */
  }
}

/**
 * Per-conversation "do not learn" toggle. The v1.3 deliverable persists
 * the flag to `localStorage` keyed on the conversation id; v1.4 will wire
 * a server-side PATCH against the conversation metadata. The component
 * accepts an `initialValue` so v1.4 can pre-seed from the server response
 * and gradually drop the localStorage path.
 *
 * Server-side enforcement (skipping extraction when paused) is owned by
 * the backend in v1.4 — for v1.3 this is UI + storage only.
 */
export function SensitivityToggle({
  conversationId,
  initialValue,
  showBanner = true,
  serverPersist,
}: Props) {
  const t = useTranslations("brain.sensitivity");
  const useServer = !!serverPersist;
  const [paused, setPaused] = useState<boolean>(useServer ? serverPersist!.paused : !!initialValue);
  const [hydrated, setHydrated] = useState<boolean>(useServer); // server mode: hydrated immediately from prop
  const [busy, setBusy] = useState(false);

  // Keep state in sync with server-driven prop changes.
  useEffect(() => {
    if (useServer) {
      setPaused(serverPersist!.paused);
    }
  }, [useServer, serverPersist]);

  useEffect(() => {
    if (useServer) return; // server mode: no localStorage read
    const map = readMap();
    if (typeof map[conversationId] === "boolean") {
      setPaused(map[conversationId]!);
    }
    setHydrated(true);
  }, [conversationId, useServer]);

  const onChange = useCallback(
    async (next: boolean) => {
      // Optimistic update either way.
      const previous = paused;
      setPaused(next);
      if (useServer) {
        setBusy(true);
        try {
          await serverPersist!.onToggle(next);
        } catch {
          // Roll back optimistic UI on error — the caller is expected to
          // surface a toast.error.
          setPaused(previous);
        } finally {
          setBusy(false);
        }
        return;
      }
      const map = readMap();
      if (next) map[conversationId] = true;
      else delete map[conversationId];
      writeMap(map);
    },
    [conversationId, useServer, serverPersist, paused]
  );

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-strong">{t("toggleLabel")}</p>
          <p className="mt-0.5 text-xs text-muted">{t("toggleHelp")}</p>
        </div>
        <Switch
          isSelected={paused}
          onValueChange={onChange}
          isDisabled={!hydrated || busy}
          aria-label={t("toggleLabel")}
        />
      </label>
      {showBanner && paused ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-100/90">
          <ShieldOff className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
          <span>{t("bannerPaused")}</span>
        </div>
      ) : null}
    </div>
  );
}
