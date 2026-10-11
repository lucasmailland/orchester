import crypto from "node:crypto";

/** Stripe's default tolerance for the signed timestamp (anti-replay). */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * Result of checking a `Stripe-Signature` header.
 *
 * Not a boolean on purpose: "unconfigured" must never read as "verified".
 * Without a webhook secret nothing can be checked, so the caller refuses the
 * event instead of processing it unsigned.
 */
export type StripeSignatureCheck = "ok" | "unconfigured" | "missing" | "stale" | "invalid";

/**
 * Verifies `t=<unix>,v1=<hex>[,v1=<hex>...]` against HMAC-SHA256 of
 * `${t}.${raw}` with the endpoint secret. Stripe may send several `v1`
 * entries while a secret is being rolled; any one matching is enough.
 */
export function checkStripeSignature(
  secret: string | undefined,
  header: string | null,
  raw: string,
  nowSeconds: number = Date.now() / 1000
): StripeSignatureCheck {
  if (!secret) return "unconfigured";
  if (!header) return "missing";

  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t" && value) timestamp = Number(value);
    else if (key === "v1" && value) signatures.push(value);
  }

  if (!timestamp || Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return "stale";
  }

  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex"),
    "hex"
  );
  const matches = signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  return matches ? "ok" : "invalid";
}
