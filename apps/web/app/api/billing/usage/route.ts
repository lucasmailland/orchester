import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { getMonthlyUsage, getWorkspacePlan } from "@/lib/billing/quotas";
import { PLANS } from "@/lib/billing/plans";

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const plan = await getWorkspacePlan(ws.workspace.id);
  const usage = await getMonthlyUsage(ws.workspace.id);
  const limits = PLANS[plan].limits;
  return NextResponse.json({
    plan,
    planMeta: { name: PLANS[plan].name, priceUsd: PLANS[plan].priceUsd },
    usage,
    limits,
  });
}
