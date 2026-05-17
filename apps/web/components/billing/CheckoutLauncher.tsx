"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CreditCard } from "lucide-react";

/**
 * Dispara el checkout de Stripe apenas monta. Si Stripe no está configurado
 * (self-host) o el plan ya es el actual, redirige al dashboard sin trabarse.
 */
export function CheckoutLauncher({ locale, plan }: { locale: string; plan: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState("Preparando tu suscripción…");
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    (async () => {
      try {
        const r = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        const j = await r.json();
        if (r.ok && j.url) {
          window.location.href = j.url;
          return;
        }
        // Stripe off o error → seguimos al dashboard, el plan free igual sirve.
        setMsg("Billing no disponible en este deployment. Te llevamos al panel…");
        setTimeout(() => router.replace(`/${locale}`), 1500);
      } catch {
        setMsg("No se pudo iniciar el pago. Te llevamos al panel…");
        setTimeout(() => router.replace(`/${locale}`), 1500);
      }
    })();
  }, [locale, plan, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black px-4 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 text-white">
        <CreditCard className="h-6 w-6" />
      </div>
      <p className="mt-5 flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> {msg}
      </p>
    </div>
  );
}
