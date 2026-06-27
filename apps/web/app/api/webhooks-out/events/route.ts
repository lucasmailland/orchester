import { NextResponse } from "next/server";
import { requireAction } from "@/lib/auth-guards";
import { WEBHOOK_EVENTS } from "@/lib/webhooks-out";

/** GET /api/webhooks-out/events → catálogo de eventos suscribibles. */
export async function GET() {
  const result = await requireAction({
    run: async () => {
      return { events: WEBHOOK_EVENTS };
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}
