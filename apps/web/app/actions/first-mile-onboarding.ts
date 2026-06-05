"use server";

import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";

/**
 * Helpers for the first-mile onboarding wizard.
 *
 * These wrap the legacy workspace-creation logic so the wizard can run when
 * the signed-in user has no workspace yet (provider/agent endpoints all
 * require `workspaceId`).
 */

/**
 * Idempotently ensures the caller has at least one workspace. Returns the
 * slug of the workspace the wizard should operate on. Picks the oldest
 * existing workspace if one is already there (mirrors `getCurrentWorkspace`).
 */
export async function ensureWorkspaceAction(): Promise<{ slug: string; id: string }> {
  const session = await getCurrentSession();
  if (!session) throw new Error("Not authenticated");

  const db = getDb();

  // Reuse if the user already has a workspace.
  const existing = await db
    .select({ id: schema.workspaces.id, slug: schema.workspaces.slug })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
    .where(eq(schema.workspaceMembers.userId, session.user.id))
    .limit(1);

  if (existing[0]) {
    return { slug: existing[0].slug, id: existing[0].id };
  }

  // Otherwise create a default personal workspace. Slug derived from email
  // local-part to avoid collisions; if it clashes we suffix a short cuid.
  const local = (session.user.email ?? "team").split("@")[0]!.toLowerCase();
  const safe = local.replace(/[^a-z0-9-]/g, "-").slice(0, 24) || "team";

  const slug = `${safe}-${createId().slice(0, 6)}`;
  const workspaceId = createId();
  const orgId = `org_${workspaceId}`;

  await db.insert(schema.orgs).values({
    id: orgId,
    name: session.user.name ?? "Personal",
    ownerUserId: session.user.id,
  });

  await db.insert(schema.workspaces).values({
    id: workspaceId,
    name: session.user.name ?? "Personal",
    slug,
    ownerUserId: session.user.id,
    orgId,
  });

  await db.insert(schema.workspaceMembers).values({
    id: createId(),
    workspaceId,
    userId: session.user.id,
    role: "owner",
  });

  return { slug, id: workspaceId };
}

/**
 * Checks whether the seeded acme-inc sample workspace is accessible to this
 * user. The toggle on the Welcome step is greyed out when this returns null.
 */
export async function getSampleWorkspaceSlugAction(): Promise<string | null> {
  const session = await getCurrentSession();
  if (!session) return null;
  const db = getDb();
  const row = await db
    .select({ slug: schema.workspaces.slug })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
    .where(
      and(
        eq(schema.workspaceMembers.userId, session.user.id),
        eq(schema.workspaces.slug, "acme-inc")
      )
    )
    .limit(1);
  return row[0]?.slug ?? null;
}
