"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, AlertTriangle } from "lucide-react";

interface Summary {
  configured: boolean;
  hasHistoricalActivity: boolean;
}

/**
 * Banner que aparece cuando el workspace no tiene un proveedor de IA conectado.
 * Distingue 2 casos:
 *   - Onboarding (sin actividad histórica) → "configurá uno para empezar"
 *   - Producción rota (con actividad histórica pero key desconectada) →
 *     "tus agentes no van a responder a nuevas conversaciones"
 */
export function NoProviderBanner() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "es";
  const ws = params?.workspaceSlug ?? "";

  useEffect(() => {
    fetch("/api/providers?summary=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Summary | null) => setSummary(d))
      .catch(() => setSummary(null));
  }, []);

  if (!summary || summary.configured) return null;

  const isDisconnected = summary.hasHistoricalActivity;
  const Icon = isDisconnected ? AlertTriangle : AlertCircle;
  const styles = isDisconnected
    ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-200 hover:bg-red-500/15"
    : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-200 hover:bg-amber-500/10";

  return (
    <Link
      href={`/${locale}/${ws}/settings`}
      className={`mb-3 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs ${styles}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>
        {isDisconnected ? (
          <>
            <strong>Tu proveedor de IA está desconectado.</strong> Los agentes no responderán a
            nuevas conversaciones hasta que reconectes una key en{" "}
            <strong>Ajustes → Proveedores de IA</strong>.
          </>
        ) : (
          <>
            Aún no configuraste un proveedor de IA. Andá a{" "}
            <strong>Ajustes → Proveedores de IA</strong> y conectá Anthropic, OpenAI o Google para
            habilitar agentes y flujos.
          </>
        )}
      </span>
    </Link>
  );
}
