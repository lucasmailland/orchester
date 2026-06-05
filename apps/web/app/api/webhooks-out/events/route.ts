import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { WEBHOOK_EVENTS } from "@/lib/webhooks-out";

/** GET /api/webhooks-out/events → catálogo de eventos suscribibles. */
export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ events: WEBHOOK_EVENTS });
}
