"use client";
import { useState, useMemo } from "react";
import { useRouter, useParams, usePathname } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMyWorkspaces, type MyWorkspace } from "./hooks/useMyWorkspaces";
import { WorkspaceAvatar } from "./WorkspaceAvatar";
import { cn } from "@/lib/utils";

interface Props {
  onClose: () => void;
  activeSlug: string | null;
  onCreate: () => void;
}

/**
 * Build the post-switch URL for a workspace change, preserving only the
 * top-level section (e.g. "/agents") and dropping any deeper segments
 * because those almost always contain IDs scoped to the *previous*
 * tenant. Carrying those IDs across to the new tenant under FORCE RLS
 * yields a 403/404 (B4.1).
 *
 * Examples:
 *   ("/en/old/agents/abc123", "en", "old", "new") -> "/en/new/agents"
 *   ("/en/old/agents",        "en", "old", "new") -> "/en/new/agents"
 *   ("/en/old",               "en", "old", "new") -> "/en/new"
 *   ("/en/somewhere-else",    "en", "old", "new") -> "/en/new"
 *   ("/en/old-extra/x",       "en", "old", "new") -> "/en/new"  (prefix guard)
 *   (anything,                "en", null,  "new") -> "/en/new"
 */
export function buildSwitchTarget(
  currentPath: string,
  locale: string,
  fromSlug: string | null,
  toSlug: string
): string {
  if (!fromSlug) return `/${locale}/${toSlug}`;
  const prefix = `/${locale}/${fromSlug}`;
  if (currentPath !== prefix && !currentPath.startsWith(prefix + "/")) {
    return `/${locale}/${toSlug}`;
  }
  const after = currentPath.slice(prefix.length);
  const firstSegmentMatch = after.match(/^\/[^/]+/);
  const firstSegment = firstSegmentMatch ? firstSegmentMatch[0] : "";
  return `/${locale}/${toSlug}${firstSegment}`;
}

/**
 * Searchable dropdown of the user's workspaces, anchored under the
 * switcher button. Splits the list into "current" + "other" so the
 * active workspace is always visible even when the search filter
 * would have hidden it (returning users hit ⌘⇧K → see context first).
 *
 * Switching preserves the top-level section under the active slug —
 * i.e. /en/acme/agents/abc → /en/foo/agents (no deep ID) — so the user
 * lands on the same sub-page in the new tenant without carrying a
 * tenant-scoped ID that would 403/404 under FORCE RLS.
 */
export function WorkspaceMenu({ onClose, activeSlug, onCreate }: Props) {
  const t = useTranslations("workspace.switcher");
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const pathname = usePathname();
  const locale = params?.locale ?? "en";
  const [query, setQuery] = useState("");
  const { workspaces, isLoading } = useMyWorkspaces();

  const filtered = useMemo(() => {
    if (!query.trim()) return workspaces;
    const q = query.toLowerCase();
    return workspaces.filter(
      (w) => w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q)
    );
  }, [workspaces, query]);

  const current = filtered.find((w) => w.slug === activeSlug);
  const others = filtered.filter((w) => w.slug !== activeSlug);

  async function switchTo(slug: string) {
    // Persist the new active workspace via the signed-cookie endpoint
    // BEFORE navigating, to avoid a race where the new request reads
    // the stale cookie (B4.1). Direct `document.cookie` writes would
    // produce an unsigned value that the middleware now rejects —
    // route through the server so the HMAC tag is applied.
    try {
      await fetch("/api/me/active-workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
    } catch {
      // Best-effort: if the request fails we still navigate; the
      // middleware will fall back to /workspaces and the user picks
      // again. Avoid blocking the click on network blips.
    }
    const target = buildSwitchTarget(pathname ?? "", locale, activeSlug, slug);
    router.push(target);
    onClose();
  }

  return (
    <div
      role="menu"
      aria-label={t("label")}
      className="absolute left-2 top-12 z-50 w-80 rounded-xl border border-line bg-surface shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          className="flex-1 bg-transparent text-xs text-strong placeholder:text-faint outline-none"
        />
      </div>

      <div className="max-h-96 overflow-y-auto py-1">
        {isLoading && <div className="px-3 py-4 text-xs text-muted">…</div>}

        {current && (
          <>
            <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-faint">
              {t("current")}
            </div>
            <WorkspaceRow ws={current} active onClick={() => onClose()} />
          </>
        )}

        {others.length > 0 && (
          <>
            <div className="mt-1 px-3 py-1 text-[9px] uppercase tracking-wider text-faint">
              {t("other")}
            </div>
            {others.map((w) => (
              <WorkspaceRow key={w.id} ws={w} onClick={() => switchTo(w.slug)} />
            ))}
          </>
        )}
      </div>

      <div className="border-t border-line p-1">
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-body hover:bg-hover"
        >
          <Plus className="h-3.5 w-3.5" /> {t("create")}
        </button>
      </div>
    </div>
  );
}

function WorkspaceRow({
  ws,
  active = false,
  onClick,
}: {
  ws: MyWorkspace;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-hover",
        active && "bg-hover"
      )}
    >
      <WorkspaceAvatar name={ws.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-strong">{ws.name}</div>
        <div className="truncate text-[10px] text-muted">{ws.slug}</div>
      </div>
      <span className="text-[9px] uppercase tracking-wider text-faint">{ws.role}</span>
    </button>
  );
}
