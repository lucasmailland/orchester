import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { createBillingPortalSession } from "@/lib/billing/stripe";

export async function POST() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaceBilling)
    .where(eq(schema.workspaceBilling.workspaceId, ws.workspace.id))
    .limit(1);
  const row = rows[0];
  if (!row?.stripeCustomerId)
    return NextResponse.json({ error: "No Stripe customer for workspace" }, { status: 400 });

  const base = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3333";
  try {
    const portal = await createBillingPortalSession({
      customerId: row.stripeCustomerId,
      returnUrl: `${base}/settings`,
    });
    return NextResponse.json({ url: portal.url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
