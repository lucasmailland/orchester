import "server-only";

/**
 * Tiny Stripe REST wrapper — avoids pulling the SDK to keep the bundle small.
 * Requires STRIPE_SECRET_KEY env var. If unset, throws a helpful error.
 */
function getKey(): string {
  const k = process.env["STRIPE_SECRET_KEY"];
  if (!k) {
    throw new Error(
      "STRIPE_SECRET_KEY not configured — set it in .env.local to enable billing."
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
  const r = await fetch(`https://api.stripe.com/v1${path}`, init);
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
