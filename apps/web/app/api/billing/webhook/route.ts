/**
 * Stripe webhook receiver. Updates workspace_billing on subscription events.
 *
 * Signature verification lives in `checkStripeSignature`. Without
 * STRIPE_WEBHOOK_SECRET every event is refused: an unsigned event could set
 * any workspace's plan.
 */
import { NextResponse } from "next/server";
import { schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { checkStripeSignature } from "@/lib/billing/stripe-signature";

type Plan = "free" | "starter" | "pro" | "business";

export async function POST(req: Request) {
  const raw = await req.text();
  const check = checkStripeSignature(
    process.env["STRIPE_WEBHOOK_SECRET"],
    req.headers.get("stripe-signature"),
    raw
  );
  if (check === "unconfigured") {
    // No secret, no way to tell Stripe from anyone else: refuse everything.
    return NextResponse.json({ error: "billing webhook not configured" }, { status: 503 });
  }
  if (check === "missing")
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  if (check === "stale") return NextResponse.json({ error: "stale signature" }, { status: 401 });
  if (check !== "ok") return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const obj = event?.data?.object;
  const workspaceId = (obj?.metadata as Record<string, unknown> | undefined)?.workspaceId as
    string | undefined;
  const customerId = (obj?.customer as string | undefined) ?? null;

  if (!workspaceId) return NextResponse.json({ ok: true, ignored: "no workspaceId" });

  // priceId → plan pago. "free" es el default del schema (no degradamos a "starter").
  const priceMap: Record<string, Plan> = {};
  if (process.env["STRIPE_PRICE_STARTER"])
    priceMap[process.env["STRIPE_PRICE_STARTER"]!] = "starter";
  if (process.env["STRIPE_PRICE_PRO"]) priceMap[process.env["STRIPE_PRICE_PRO"]!] = "pro";
  if (process.env["STRIPE_PRICE_BUSINESS"])
    priceMap[process.env["STRIPE_PRICE_BUSINESS"]!] = "business";

  // Extracción robusta: priceId y período viven en distintos lugares según el
  // shape (Subscription vs Checkout Session) y la versión de la API de Stripe
  // (current_period_end migró a items.data[].current_period_end). El evento
  // checkout.session.completed NO trae items inline → el price/período llegan en
  // el evento customer.subscription.created/updated que Stripe dispara aparte.
  const subItems = (obj?.items as Record<string, unknown> | undefined)?.data as
    Array<{ price?: { id?: string }; current_period_end?: number }> | undefined;
  const priceId =
    subItems?.[0]?.price?.id ??
    ((obj?.plan as Record<string, unknown> | undefined)?.id as string | undefined);
  const periodEndUnix =
    (obj?.current_period_end as number | undefined) ??
    subItems?.[0]?.current_period_end ??
    undefined;
  const resolvedPlan: Plan | undefined = priceId ? priceMap[priceId] : undefined;

  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated"
  ) {
    const subId =
      (obj?.subscription as string | undefined) ??
      (event.type !== "checkout.session.completed" ? (obj?.id as string | undefined) : undefined) ??
      null;
    const cancelAtPeriodEnd = Boolean(obj?.cancel_at_period_end);
    const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null;

    // En el UPDATE sólo tocamos plan/price/período cuando los conocemos, para no
    // pisar un plan pago con el default en un evento que no trae el price.
    const set: Record<string, unknown> = {
      stripeCustomerId: customerId,
      cancelAtPeriodEnd,
      updatedAt: new Date(),
    };
    if (subId) set.stripeSubscriptionId = subId;
    if (resolvedPlan) set.plan = resolvedPlan;
    if (priceId) set.stripePriceId = priceId;
    if (periodEnd) set.currentPeriodEnd = periodEnd;

    // Stripe webhook is unauthenticated (verified via HMAC above) so the
    // request has no workspace GUC set. workspace_billing has FORCE RLS,
    // so the upsert must run as cross-tenant admin.
    await withCrossTenantAdmin("billing.stripe_webhook", async (tx) => {
      await tx
        .insert(schema.workspaceBilling)
        .values({
          workspaceId,
          plan: resolvedPlan ?? "free",
          stripeCustomerId: customerId,
          stripeSubscriptionId: subId,
          stripePriceId: priceId ?? null,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd,
        })
        .onConflictDoUpdate({ target: schema.workspaceBilling.workspaceId, set });
    });
  } else if (event.type === "customer.subscription.deleted") {
    await withCrossTenantAdmin("billing.stripe_webhook", async (tx) => {
      await tx
        .update(schema.workspaceBilling)
        .set({
          plan: "free",
          cancelAtPeriodEnd: false,
          currentPeriodEnd: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.workspaceBilling.workspaceId, workspaceId));
    });
  }

  return NextResponse.json({ ok: true });
}
