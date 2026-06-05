import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/first-mile/OnboardingWizard";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";
import { getDb, schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";

/**
 * First-mile onboarding entry point.
 *
 * Routing rules:
 *   - No session  -> /{locale}/login
 *   - Has workspace + provider + active agent + conversation -> /{locale}/{slug}
 *     (the user has already activated; do not pull them back here)
 *   - Otherwise -> render the wizard at the most advanced unfinished step
 */
export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getCurrentSession();

  if (!session) {
    redirect(`/${locale}/login`);
  }

  const ctx = await getCurrentWorkspace();
  if (!ctx) {
    // First time: no workspace at all -> always show wizard from step 0
    return <OnboardingWizard locale={locale} initialStep={0} workspaceSlug={null} />;
  }

  const db = getDb();
  const workspaceId = ctx.workspace.id;

  const [providerRow, agentRow, convRow] = await Promise.all([
    db
      .select({ id: schema.aiProviders.id })
      .from(schema.aiProviders)
      .where(eq(schema.aiProviders.workspaceId, workspaceId))
      .limit(1),
    db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(and(eq(schema.agents.workspaceId, workspaceId), eq(schema.agents.status, "active")))
      .limit(1),
    db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.workspaceId, workspaceId))
      .limit(1),
  ]);

  const hasProvider = providerRow.length > 0;
  const hasAgent = agentRow.length > 0;
  const hasConversation = convRow.length > 0;

  // Graduated user: don't force them into the wizard.
  if (hasProvider && hasAgent && hasConversation) {
    redirect(`/${locale}/${ctx.workspace.slug}`);
  }

  // Pick the most-advanced unfinished step.
  // Steps: 0 welcome, 1 provider, 2 agent, 3 talk, 4 done
  let initialStep = 0;
  if (hasProvider) initialStep = 2;
  if (hasProvider && hasAgent) initialStep = 3;

  return (
    <OnboardingWizard
      locale={locale}
      initialStep={initialStep}
      workspaceSlug={ctx.workspace.slug}
    />
  );
}
