// /[locale]/[workspaceSlug]/settings/memory — admin-only Memory
// Operations panel for Mnemosyne v1.5 "The Wire-Up".
//
// Surfaces seven "Run now" buttons that enqueue per-workspace runs of
// the otherwise weekly/daily Mnemosyne crons (health, dedup, prune,
// consolidation, review-sweep, auto-pin, summary). Plus a "Last run"
// timestamp for the health cron (read from `mnemo_health.snapshot_at`
// via the existing `/api/mnemo/health/latest` route).
//
// Lives outside the hash-tabbed `/settings` panel because each cron
// trigger is a discrete admin action with its own confirm-modal — a
// dedicated sub-route keeps the URL shareable and the per-action audit
// trail clean.
//
// Server-side render gates on workspace + role so non-admins see a
// "Not authorized" stub instead of a working panel.
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { MemoryOpsClient } from "./MemoryOpsClient";
import { notFound } from "next/navigation";

export default async function MemoryOpsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ws = await getCurrentWorkspaceBySlug(workspaceSlug);
  if (!ws) return notFound();

  const role = (ws.role ?? "viewer") as "owner" | "admin" | "editor" | "viewer";
  const isAdmin = role === "owner" || role === "admin";

  return (
    <MemoryOpsClient
      workspace={{
        id: ws.workspace.id,
        slug: ws.workspace.slug,
        name: ws.workspace.name ?? ws.workspace.slug,
      }}
      isAdmin={isAdmin}
    />
  );
}
