"use server";

import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
}

export async function createWorkspaceAction(input: CreateWorkspaceInput) {
  const session = await getCurrentSession();
  if (!session) throw new Error("Not authenticated");

  const db = getDb();
  const workspaceId = createId();

  await db.insert(schema.workspaces).values({
    id: workspaceId,
    name: input.name,
    slug: input.slug,
    // Phase A: workspace.owner_user_id is enforced NOT NULL via the
    // workspace_owner_must_be_member check constraint. Onboarding flows
    // landed before that constraint existed and silently relied on
    // backfill; new rows MUST set it here.
    ownerUserId: session.user.id,
  });

  await db.insert(schema.workspaceMembers).values({
    id: createId(),
    workspaceId,
    userId: session.user.id,
    role: "owner",
  });

  return { workspaceId };
}

export async function completeOnboardingAction(locale: string) {
  const session = await getCurrentSession();
  if (!session) throw new Error("Not authenticated");

  const db = getDb();
  await db
    .update(schema.users)
    .set({ onboardingCompleted: true, updatedAt: new Date() })
    .where(eq(schema.users.id, session.user.id));

  // Si venía de /pricing con un plan pago, lo mandamos al checkout. La cookie
  // la setea SignupForm; la limpiamos acá para no re-disparar el flujo.
  const jar = await cookies();
  const pendingPlan = jar.get("pending_plan")?.value;
  if (pendingPlan && ["starter", "pro", "business"].includes(pendingPlan)) {
    jar.delete("pending_plan");
    redirect(`/${locale}/checkout?plan=${pendingPlan}`);
  }

  redirect(`/${locale}`);
}

// generateSlug moved to /lib/slug.ts (server actions files only export async functions)
