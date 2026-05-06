import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { getMonthlyUsage, getWorkspacePlan } from "@/lib/billing/quotas";
import { PLANS } from "@/lib/billing/plans";
import { isStripeEnabled } from "@/lib/billing/stripe";

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const plan = await getWorkspacePlan(ws.workspace.id);
  const usage = await getMonthlyUsage(ws.workspace.id);
  const limits = PLANS[plan].limits;
  const stripeEnabled = isStripeEnabled();
  // En self-host (sin Stripe key), la UI muestra "Self-hosted" en lugar de
  // "Enterprise" para que el usuario no se confunda pensando que pagó algo.
  const planMeta = stripeEnabled
    ? { name: PLANS[plan].name, priceUsd: PLANS[plan].priceUsd }
    : { name: "Self-hosted", priceUsd: 0 };
  return NextResponse.json({
    plan,
    planMeta,
    stripeEnabled,
    usage,
    limits,
  });
}
