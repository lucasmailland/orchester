"use client";

import { useState } from "react";
import { X, Sparkles, ArrowRight, RotateCcw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  agentId: string;
  onClose: () => void;
  onPick: (prompt: string) => void;
}

const TONES = ["professional", "friendly", "formal", "direct"] as const;

export function PromptGeneratorModal({ open, agentId, onClose, onPick }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [description, setDescription] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]>("professional");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [variations, setVariations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/agents/${agentId}/generate-prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          tone,
          context: { companyName, industry },
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.error === "PROVIDER_NOT_CONFIGURED")
          setError("Configurá un proveedor en Ajustes para usar el generador.");
        else setError(j.error || "Error");
        return;
      }
      setVariations(j.variations);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5 text-sm font-medium text-strong">
            <Sparkles className="h-4 w-4 text-violet-400" /> Generador de prompts con IA · Paso {step}/3
          </div>
          <button onClick={onClose} className="text-muted hover:text-body" type="button">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div>
              <label className="mb-2 block text-xs font-medium text-body">
                ¿Qué hace este agente?
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                placeholder="Necesito un agente que califique leads B2B según BANT y los enrute al vendedor correcto…"
                className="w-full rounded-xl border border-line bg-zinc-900 px-3 py-2.5 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
              />
              <p className="mt-1.5 text-[11px] text-muted">
                {description.length} / 50–500 caracteres
              </p>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-body">Tono</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TONES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTone(t)}
                      className={cn(
                        "rounded-lg border px-2 py-2 text-xs",
                        tone === t
                          ? "border-violet-500/50 bg-violet-500/15 text-violet-200"
                          : "border-line text-muted hover:border-white/20"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-body">
                  Empresa (opcional)
                </label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full rounded-xl border border-line bg-zinc-900 px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-body">
                  Industria (opcional)
                </label>
                <input
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full rounded-xl border border-line bg-zinc-900 px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
                />
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-3">
              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}
              {variations.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onPick(v);
                    onClose();
                  }}
                  className="block w-full rounded-xl border border-line bg-card p-4 text-left hover:border-violet-500/40 hover:bg-zinc-900"
                >
                  <div className="mb-1 text-xs font-medium text-violet-300">Variación {i + 1}</div>
                  <pre className="whitespace-pre-wrap font-mono text-[12px] text-body">
                    {v.length > 400 ? v.slice(0, 400) + "…" : v}
                  </pre>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line bg-surface px-5 py-3">
          <button
            type="button"
            onClick={() => {
              if (step === 3) {
                setStep(2);
                setVariations([]);
              } else if (step === 2) setStep(1);
              else onClose();
            }}
            className="text-xs text-muted hover:text-body"
          >
            {step === 1 ? "Cancelar" : "Atrás"}
          </button>
          <div className="flex items-center gap-2">
            {step === 3 && (
              <button
                type="button"
                onClick={generate}
                className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs text-body hover:bg-hover"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Regenerar
              </button>
            )}
            {step !== 3 && (
              <button
                type="button"
                disabled={loading || (step === 1 && description.trim().length < 20)}
                onClick={() => {
                  if (step === 1) setStep(2);
                  else generate();
                }}
                className="flex items-center gap-1 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    {step === 2 ? "Generar" : "Siguiente"} <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
