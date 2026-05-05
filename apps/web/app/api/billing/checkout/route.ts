import { NextResponse } from "next/server";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";
import { createCheckoutSession } from "@/lib/billing/stripe";
import { PLANS, type Plan } from "@/lib/billing/plans";

export async function POST(req: Request) {
  const ws = await getCurrentWorkspace();
  const session = await getCurrentSession();
  if (!ws || !session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const plan = String(body?.plan ?? "") as Plan;
  if (!PLANS[plan]) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  const priceEnv = PLANS[plan].stripePriceEnv;
  if (!priceEnv)
    return NextResponse.json({ error: "Plan does not have a Stripe price" }, { status: 400 });
  const priceId = process.env[priceEnv];
  if (!priceId)
    return NextResponse.json(
      { error: `${priceEnv} env var not configured` },
      { status: 500 }
    );

  const base = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3333";
  try {
    const checkout = await createCheckoutSession({
      customerEmail: session.user.email,
      priceId,
      successUrl: `${base}/settings?billing=success`,
      cancelUrl: `${base}/pricing?billing=cancel`,
      workspaceId: ws.workspace.id,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
