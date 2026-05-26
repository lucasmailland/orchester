"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type PlanId = "free" | "starter" | "pro" | "business";

interface Props {
  locale: string;
  plan: PlanId;
  label: string;
  highlight?: boolean;
}

interface UsagePayload {
  plan: string;
  stripeEnabled?: boolean;
}

/**
 * CTA inteligente para la página de precios pública.
 *
 * - No logueado → /signup?plan=X (el plan se persiste y se cobra post-onboarding)
 * - Logueado + plan actual === plan → "Plan actual" deshabilitado
 * - Logueado + plan free → al dashboard
 * - Logueado + plan pago + Stripe ON → POST /api/billing/checkout → Stripe
 * - Logueado + Stripe OFF (self-host) → toast informativo (sin límites)
 * - business → siempre mailto a ventas
 */
export function PricingCta({ locale, plan, label, highlight }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "anon" | "authed">("loading");
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [stripeEnabled, setStripeEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/billing/usage")
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 401) {
          setStatus("anon");
          return;
        }
        const j = (await r.json()) as UsagePayload;
        setStatus("authed");
        setCurrentPlan(j.plan ?? null);
        setStripeEnabled(j.stripeEnabled !== false);
      })
      .catch(() => alive && setStatus("anon"));
    return () => {
      alive = false;
    };
  }, []);

  const base = highlight
    ? "mt-6 block w-full rounded-lg bg-violet-500 py-2 text-center text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-50"
    : "mt-6 block w-full rounded-lg border border-line py-2 text-center text-sm font-medium text-body hover:bg-hover disabled:opacity-50";

  if (plan === "business") {
    return (
      <a href="mailto:enterprise@orchester.io" className={base}>
        {label}
      </a>
    );
  }

  if (status === "loading") {
    return (
      <button type="button" disabled className={base}>
        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
      </button>
    );
  }

  if (status === "anon") {
    return (
      <a href={`/${locale}/signup?plan=${plan}`} className={base}>
        {label}
      </a>
    );
  }

  // Authenticated
  if (currentPlan === plan) {
    return (
      <button type="button" disabled className={base}>
        Plan actual
      </button>
    );
  }

  async function handleClick() {
    if (plan === "free") {
      router.push(`/${locale}`);
      return;
    }
    if (!stripeEnabled) {
      toast.info("This deployment is self-hosted — usage is already unlimited.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const j = await r.json();
      if (r.ok && j.url) {
        window.location.href = j.url;
      } else {
        toast.error(j.error ?? "No se pudo iniciar el checkout");
        setBusy(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error de red");
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={busy} className={base}>
      {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : label}
    </button>
  );
}
