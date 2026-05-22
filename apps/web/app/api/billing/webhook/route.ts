/**
 * Stripe webhook receiver. Updates workspace_billing on subscription events.
 *
 * Signature verification: HMAC-SHA256 del payload con STRIPE_WEBHOOK_SECRET,
 * comparación en tiempo constante + tolerancia de timestamp (anti-replay).
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";

type Plan = "free" | "starter" | "pro" | "business";

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export async function POST(req: Request) {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();

  if (secret) {
    if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });
    // Formato Stripe: t=timestamp,v1=hex_hmac
    const parts = sig.split(",").reduce<Record<string, string>>((acc, p) => {
      const [k, v] = p.split("=");
      if (k && v) acc[k] = v;
      return acc;
    }, {});
    // Anti-replay: rechazá firmas fuera de la ventana de tolerancia.
    const ts = Number(parts.t);
    if (!ts || Math.abs(Date.now() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) {
      return NextResponse.json({ error: "stale signature" }, { status: 401 });
    }
    const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex");
    // Comparación en tiempo constante (evita timing attacks).
    const sigBuf = Buffer.from(parts.v1 ?? "", "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  const event = JSON.parse(raw) as { type: string; data: { object: Record<string, unknown> } };
  const obj = event.data.object;
  const workspaceId = (obj?.metadata as Record<string, unknown> | undefined)?.workspaceId as
    | string
    | undefined;
  const customerId = (obj?.customer as string | undefined) ?? null;

  if (!workspaceId) return NextResponse.json({ ok: true, ignored: "no workspaceId" });
  const db = getDb();

  // priceId → plan pago. "free" es el default del schema (no degradamos a "starter").
  const priceMap: Record<string, Plan> = {};
  if (process.env["STRIPE_PRICE_STARTER"]) priceMap[process.env["STRIPE_PRICE_STARTER"]!] = "starter";
  if (process.env["STRIPE_PRICE_PRO"]) priceMap[process.env["STRIPE_PRICE_PRO"]!] = "pro";
  if (process.env["STRIPE_PRICE_BUSINESS"]) priceMap[process.env["STRIPE_PRICE_BUSINESS"]!] = "business";

  // Extracción robusta: priceId y período viven en distintos lugares según el
  // shape (Subscription vs Checkout Session) y la versión de la API de Stripe
  // (current_period_end migró a items.data[].current_period_end). El evento
  // checkout.session.completed NO trae items inline → el price/período llegan en
  // el evento customer.subscription.created/updated que Stripe dispara aparte.
  const subItems = (obj?.items as Record<string, unknown> | undefined)?.data as
    | Array<{ price?: { id?: string }; current_period_end?: number }>
    | undefined;
  const priceId =
    subItems?.[0]?.price?.id ??
    ((obj?.plan as Record<string, unknown> | undefined)?.id as string | undefined);
  const periodEndUnix =
    (obj?.current_period_end as number | undefined) ?? subItems?.[0]?.current_period_end ?? undefined;
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

    await db
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
  } else if (event.type === "customer.subscription.deleted") {
    await db
      .update(schema.workspaceBilling)
      .set({ plan: "free", cancelAtPeriodEnd: false, currentPeriodEnd: null, updatedAt: new Date() })
      .where(eq(schema.workspaceBilling.workspaceId, workspaceId));
  }

  return NextResponse.json({ ok: true });
}
