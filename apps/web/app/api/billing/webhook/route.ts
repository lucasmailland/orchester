/**
 * Stripe webhook receiver. Updates workspace_billing on subscription events.
 *
 * Signature verification with Stripe: requires STRIPE_WEBHOOK_SECRET.
 * We do simple HMAC-SHA256 of the raw body.
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();

  if (secret) {
    if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });
    // Stripe signature format: t=timestamp,v1=hex_hmac
    const parts = sig.split(",").reduce<Record<string, string>>((acc, p) => {
      const [k, v] = p.split("=");
      if (k && v) acc[k] = v;
      return acc;
    }, {});
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${parts.t}.${raw}`)
      .digest("hex");
    if (parts.v1 !== expected) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  const event = JSON.parse(raw) as { type: string; data: { object: Record<string, unknown> } };
  const obj = event.data.object;
  const workspaceId =
    (obj?.metadata as Record<string, unknown> | undefined)?.workspaceId as string | undefined;
  const customerId = obj?.customer as string | undefined;
  const subscriptionId = obj?.subscription as string | undefined;
  const priceId = ((obj?.items as Record<string, unknown> | undefined)?.data as Array<{ price: { id: string } }> | undefined)?.[0]?.price?.id;

  if (!workspaceId) return NextResponse.json({ ok: true, ignored: "no workspaceId" });
  const db = getDb();

  // Map priceId → plan
  const priceMap: Record<string, "starter" | "pro" | "business"> = {};
  if (process.env["STRIPE_PRICE_STARTER"]) priceMap[process.env["STRIPE_PRICE_STARTER"]] = "starter";
  if (process.env["STRIPE_PRICE_PRO"]) priceMap[process.env["STRIPE_PRICE_PRO"]] = "pro";
  if (process.env["STRIPE_PRICE_BUSINESS"]) priceMap[process.env["STRIPE_PRICE_BUSINESS"]] = "business";

  const matchedPlan: "starter" | "pro" | "business" = (priceId ? priceMap[priceId] : undefined) ?? "starter";

  if (event.type === "checkout.session.completed" || event.type === "customer.subscription.updated") {
    const periodEnd = (obj?.current_period_end as number | undefined) ?? null;
    const cancelAtPeriodEnd = Boolean(obj?.cancel_at_period_end);
    await db
      .insert(schema.workspaceBilling)
      .values({
        workspaceId,
        plan: matchedPlan,
        stripeCustomerId: customerId ?? null,
        stripeSubscriptionId: (subscriptionId ?? (obj?.id as string | undefined)) ?? null,
        stripePriceId: priceId ?? null,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        cancelAtPeriodEnd,
      })
      .onConflictDoUpdate({
        target: schema.workspaceBilling.workspaceId,
        set: {
          plan: matchedPlan,
          stripeCustomerId: customerId ?? null,
          stripeSubscriptionId: (subscriptionId ?? (obj?.id as string | undefined)) ?? null,
          stripePriceId: priceId ?? null,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
          cancelAtPeriodEnd,
          updatedAt: new Date(),
        },
      });
  } else if (event.type === "customer.subscription.deleted") {
    await db
      .update(schema.workspaceBilling)
      .set({ plan: "free", cancelAtPeriodEnd: false, updatedAt: new Date() })
      .where(eq(schema.workspaceBilling.workspaceId, workspaceId));
  }

  return NextResponse.json({ ok: true });
}
