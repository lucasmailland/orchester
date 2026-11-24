import crypto from "node:crypto";

/** How far the signed timestamp may be from now, in either direction. */
export const FLOW_WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Result of checking `x-orchester-signature` on an inbound flow webhook.
 *
 * Format: `t=<unix seconds>,v1=<hex>` where
 * `v1 = HMAC-SHA256(hmacKey, "<t>.<search>.<rawBody>")` and `search` is the
 * request's `url.search` verbatim (with the `?`, or empty), so the query
 * string is covered too. "legacy" is the old bare hex HMAC of the body alone:
 * it never expires, so the caller only accepts it behind an opt-in flag.
 *
 * ponytail: a captured request can be replayed inside the 300 s window;
 * closing that needs storing seen signatures (e.g. a short-TTL cache keyed by
 * v1) and rejecting repeats.
 */
export type FlowSignatureCheck = "ok" | "missing" | "malformed" | "stale" | "mismatch" | "legacy";

const hmac = (key: string, data: string) =>
  crypto.createHmac("sha256", key).update(data).digest("hex");

function equalHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

export function signFlowWebhook(
  hmacKey: string,
  search: string,
  rawBody: string,
  t: number
): string {
  return `t=${t},v1=${hmac(hmacKey, `${t}.${search}.${rawBody}`)}`;
}

export function checkFlowWebhookSignature(
  hmacKey: string,
  header: string | null,
  search: string,
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): FlowSignatureCheck {
  if (!header) return "missing";

  if (/^[0-9a-f]{64}$/i.test(header)) {
    return equalHex(header, hmac(hmacKey, rawBody)) ? "legacy" : "mismatch";
  }

  let t = "";
  let v1 = "";
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") t = value ?? "";
    else if (key === "v1") v1 = value ?? "";
  }
  if (!/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/i.test(v1)) return "malformed";

  const ts = Number(t);
  if (Math.abs(nowSeconds - ts) > FLOW_WEBHOOK_TOLERANCE_SECONDS) return "stale";
  return equalHex(v1, hmac(hmacKey, `${ts}.${search}.${rawBody}`)) ? "ok" : "mismatch";
}
