import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { createCheckoutSession } from "@/lib/billing/stripe";
import { PLANS, type Plan } from "@/lib/billing/plans";
import { handleError } from "@/lib/api-response";

const checkoutSchema = z.object({
  plan: z.string().optional(),
});

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, checkoutSchema);
  if (!parsed.ok) return parsed.response;
  const plan = String(parsed.data.plan ?? "") as Plan;
  if (!PLANS[plan]) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  const priceEnv = PLANS[plan].stripePriceEnv;
  if (!priceEnv)
    return NextResponse.json({ error: "Plan does not have a Stripe price" }, { status: 400 });
  const priceId = process.env[priceEnv];
  if (!priceId)
    return NextResponse.json({ error: `${priceEnv} env var not configured` }, { status: 500 });

  const base = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3333";
  try {
    const checkout = await createCheckoutSession({
      customerEmail: ctx.user.email,
      priceId,
      successUrl: `${base}/settings?billing=success`,
      cancelUrl: `${base}/pricing?billing=cancel`,
      workspaceId: ctx.workspace.id,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    return handleError("[billing/checkout]", e, 500);
  }
}
