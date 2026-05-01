"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

export function NoProviderBanner() {
  const [show, setShow] = useState(false);
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "es";

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d) => setShow(!Array.isArray(d) || d.length === 0))
      .catch(() => setShow(false));
  }, []);

  if (!show) return null;
  return (
    <Link
      href={`/${locale}/settings`}
      className="mb-3 flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 text-xs text-amber-200 hover:bg-amber-500/10"
    >
      <AlertCircle className="h-4 w-4" />
      <span>
        Aún no configuraste un proveedor de IA. Andá a <strong>Ajustes → Proveedores de IA</strong>{" "}
        y conectá Anthropic, OpenAI o Google para habilitar agentes y flujos.
      </span>
    </Link>
  );
}
