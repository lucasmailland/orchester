import { NextResponse } from "next/server";
import { requireAction } from "@/lib/auth-guards";
import { getMonthlyUsage, getWorkspacePlan } from "@/lib/billing/quotas";
import { PLANS } from "@/lib/billing/plans";
import { isStripeEnabled } from "@/lib/billing/stripe";

export async function GET() {
  const result = await requireAction({
    run: async ({ ctx }) => {
      const plan = await getWorkspacePlan(ctx.workspace.id);
      const usage = await getMonthlyUsage(ctx.workspace.id);
      const limits = PLANS[plan].limits;
      const stripeEnabled = isStripeEnabled();
      // En self-host (sin Stripe key), la UI muestra "Self-hosted" en lugar de
      // "Enterprise" para que el usuario no se confunda pensando que pagó algo.
      const planMeta = stripeEnabled
        ? { name: PLANS[plan].name, priceUsd: PLANS[plan].priceUsd }
        : { name: "Self-hosted", priceUsd: 0 };
      return { plan, planMeta, stripeEnabled, usage, limits };
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
