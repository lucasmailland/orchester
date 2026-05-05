"use server";

import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";
import { redirect } from "next/navigation";

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

  redirect(`/${locale}`);
}

// generateSlug moved to /lib/slug.ts (server actions files only export async functions)
