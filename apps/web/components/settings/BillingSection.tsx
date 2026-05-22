"use client";

import { useEffect, useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface UsagePayload {
  plan: string;
  planMeta: { name: string; priceUsd: number };
  /** Si es false, estamos en self-host: esconder upgrade/portal flows. */
  stripeEnabled?: boolean;
  usage: {
    conversations: number;
    tokensIn: number;
    tokensOut: number;
    flowRuns: number;
    kbQueries: number;
    webhookCalls: number;
  };
  limits: {
    agents: number;
    flows: number;
    conversationsPerMonth: number;
    tokensPerMonth: number;
    members: number;
    knowledgeBases: number;
  };
}

export function BillingSection() {
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/billing/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  async function checkout(plan: string) {
    setBusy(true);
    const r = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    setBusy(false);
    const j = await r.json();
    if (r.ok && j.url) window.location.href = j.url;
    else toast.error(j.error ?? "Stripe no configurado — definí STRIPE_SECRET_KEY + STRIPE_PRICE_*");
  }

  async function openPortal() {
    setBusy(true);
    const r = await fetch("/api/billing/portal", { method: "POST" });
    setBusy(false);
    const j = await r.json();
    if (r.ok && j.url) window.location.href = j.url;
    else toast.error(j.error ?? "No hay cliente Stripe asociado");
  }

  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-muted" />;
  if (!data) return null;

  const tokensTotal = data.usage.tokensIn + data.usage.tokensOut;
  const tokensPct = Math.min(100, (tokensTotal / data.limits.tokensPerMonth) * 100);
  const convsPct = Math.min(100, (data.usage.conversations / data.limits.conversationsPerMonth) * 100);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted">Plan actual</div>
            <div className="text-lg font-semibold text-strong">
              {data.planMeta.name}{" "}
              <span className="text-sm text-muted">
                {data.stripeEnabled === false ? "· sin límites" : `· $${data.planMeta.priceUsd}/mes`}
              </span>
            </div>
          </div>
          {data.stripeEnabled === false ? null : data.plan === "free" ? (
            <button
              type="button"
              onClick={() => checkout("pro")}
              disabled={busy}
              className="flex items-center gap-1 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400"
            >
              Upgrade a Pro <ExternalLink className="h-3 w-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={openPortal}
              disabled={busy}
              className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs text-body hover:bg-hover"
            >
              Gestionar suscripción <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="space-y-3 text-xs">
          <UsageBar
            label="Conversaciones (mes)"
            current={data.usage.conversations}
            limit={data.limits.conversationsPerMonth}
            pct={convsPct}
          />
          <UsageBar
            label="Tokens (mes)"
            current={tokensTotal}
            limit={data.limits.tokensPerMonth}
            pct={tokensPct}
          />
          <div className="grid grid-cols-2 gap-3 text-muted">
            <span>Flow runs: <strong className="text-body">{data.usage.flowRuns}</strong></span>
            <span>KB queries: <strong className="text-body">{data.usage.kbQueries}</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
}

function UsageBar({ label, current, limit, pct }: { label: string; current: number | null | undefined; limit: number | null | undefined; pct: number }) {
  const tone = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-violet-500";
  const fmt = (n: number | null | undefined) => {
    const v = Number(n ?? 0);
    return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v);
  };
  const limitTxt = limit != null && isFinite(limit) ? fmt(limit) : "∞";
  return (
    <div>
      <div className="mb-1 flex justify-between text-muted">
        <span>{label}</span>
        <span className="font-mono text-[10px]">
          {fmt(current)} / {limitTxt}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
