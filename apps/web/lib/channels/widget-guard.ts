import "server-only";
import { z } from "zod";
import { rateLimit, type RateLimitOptions } from "@/lib/rate-limit";

/**
 * Shared guards for the public widget endpoints (`/api/widget/[channelId]/*`).
 *
 * Those endpoints take anonymous traffic from any origin and every accepted
 * message runs the agent, so each one costs LLM tokens. They need limits that
 * hold without an account to throttle.
 */

export const WIDGET_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

/** Longest visitor message the widget forwards to the agent. */
export const WIDGET_MAX_TEXT_CHARS = 4000;

export const WIDGET_LIMITS = {
  /** One visitor address: a person typing, with room for retries. */
  perClient: { capacity: 10, refillPerSec: 10 / 60 },
  /**
   * The whole channel. The client address comes from X-Forwarded-For, which a
   * caller can forge, so this bucket is the ceiling that holds regardless.
   */
  perChannel: { capacity: 60, refillPerSec: 60 / 60 },
} satisfies Record<string, RateLimitOptions>;

export const widgetMessageSchema = z.object({
  visitorId: z.string().trim().min(1, "visitorId and text required").max(128),
  text: z.string().trim().min(1, "visitorId and text required").max(WIDGET_MAX_TEXT_CHARS),
  customerName: z.string().trim().max(200).optional(),
  customerEmail: z.string().trim().max(320).optional(),
});

export type WidgetMessage = z.infer<typeof widgetMessageSchema>;

/** Best-effort client address: first X-Forwarded-For hop, then X-Real-IP. */
export function widgetClientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

function tooManyRequests(retryAfterMs: number): Response {
  return new Response(JSON.stringify({ error: "Too many requests", retryAfterMs }), {
    status: 429,
    headers: {
      ...WIDGET_CORS_HEADERS,
      "content-type": "application/json",
      "retry-after": String(Math.ceil(retryAfterMs / 1000)),
    },
  });
}

/**
 * Spends one token from the visitor's bucket and one from the channel's.
 * Returns a ready 429 (with CORS headers) when either is empty, else null.
 */
export async function enforceWidgetRateLimit(
  channelId: string,
  headers: Headers
): Promise<Response | null> {
  const client = await rateLimit(
    `widget:${channelId}:client:${widgetClientAddress(headers)}`,
    WIDGET_LIMITS.perClient
  );
  if (!client.ok) return tooManyRequests(client.retryAfterMs ?? 1000);

  const channel = await rateLimit(`widget:${channelId}`, WIDGET_LIMITS.perChannel);
  if (!channel.ok) return tooManyRequests(channel.retryAfterMs ?? 1000);

  return null;
}

/**
 * Parses and bounds the request body. Returns the message, or a ready 400
 * with CORS headers.
 */
export async function parseWidgetMessage(
  req: Request
): Promise<{ ok: true; message: WidgetMessage } | { ok: false; response: Response }> {
  const raw = await req.json().catch(() => ({}));
  const parsed = widgetMessageSchema.safeParse(raw);
  if (parsed.success) return { ok: true, message: parsed.data };
  return {
    ok: false,
    response: new Response(
      JSON.stringify({
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      }),
      { status: 400, headers: { ...WIDGET_CORS_HEADERS, "content-type": "application/json" } }
    ),
  };
}
