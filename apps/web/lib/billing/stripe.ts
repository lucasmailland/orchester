import "server-only";
import { fetchWithTimeout } from "@/lib/http-util";

const STRIPE_TIMEOUT_MS = 30_000;

/**
 * Tiny Stripe REST wrapper — avoids pulling the SDK to keep the bundle small.
 * STRIPE_SECRET_KEY es opcional: si no está configurado, billing queda
 * desactivado y `isStripeEnabled()` devuelve false. La UI debe esconder
 * los flujos de upgrade en ese caso (self-hosted / OSS).
 */
export function isStripeEnabled(): boolean {
  return Boolean(process.env["STRIPE_SECRET_KEY"]);
}

function getKey(): string {
  const k = process.env["STRIPE_SECRET_KEY"];
  if (!k) {
    throw new Error(
      "Stripe billing is disabled in this deployment (STRIPE_SECRET_KEY not set). " +
        "This is expected on self-hosted / OSS installs."
    );
  }
  return k;
}

async function stripeFetch(
  path: string,
  opts: { method?: "GET" | "POST"; body?: Record<string, string> } = {}
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  if (opts.body) {
    for (const [k, v] of Object.entries(opts.body)) {
      params.append(k, v);
    }
  }
  const init: RequestInit = {
    method: opts.method ?? "POST",
    headers: {
      Authorization: `Bearer ${getKey()}`,
      "content-type": "application/x-www-form-urlencoded",
    },
  };
  if (opts.method !== "GET") init.body = params.toString();
  const r = await fetchWithTimeout(`https://api.stripe.com/v1${path}`, init, STRIPE_TIMEOUT_MS);
  const j = await r.json();
  if (!r.ok) {
    throw new Error(`Stripe ${r.status}: ${j.error?.message ?? JSON.stringify(j)}`);
  }
  return j;
}

export async function createCheckoutSession(params: {
  customerEmail: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  workspaceId: string;
}): Promise<{ id: string; url: string }> {
  const j = await stripeFetch("/checkout/sessions", {
    body: {
      mode: "subscription",
      "line_items[0][price]": params.priceId,
      "line_items[0][quantity]": "1",
      customer_email: params.customerEmail,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      "metadata[workspaceId]": params.workspaceId,
      "subscription_data[metadata][workspaceId]": params.workspaceId,
    },
  });
  return { id: String(j.id), url: String(j.url) };
}

export async function createBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const j = await stripeFetch("/billing_portal/sessions", {
    body: {
      customer: params.customerId,
      return_url: params.returnUrl,
    },
  });
  return { url: String(j.url) };
}
