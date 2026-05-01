"use client";

import { useMemo } from "react";
import { Sparkles, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { promptQuality } from "./promptQuality";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onGenerate?: () => void;
  onTemplates?: () => void;
}

export function PromptEditor({ value, onChange, onGenerate, onTemplates }: Props) {
  const q = useMemo(() => promptQuality(value), [value]);
  const tone =
    q.label === "Excellent"
      ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
      : q.label === "Good"
      ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
      : "text-red-400 border-red-500/30 bg-red-500/10";

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.08] bg-zinc-900/40">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={onGenerate}
            type="button"
            className="flex items-center gap-1.5 rounded-lg bg-violet-500/15 px-2.5 py-1.5 text-xs text-violet-300 hover:bg-violet-500/25"
          >
            <Sparkles className="h-3.5 w-3.5" /> Generar con IA
          </button>
          <button
            onClick={onTemplates}
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
          >
            <BookOpen className="h-3.5 w-3.5" /> Plantillas
          </button>
        </div>
        <div className={cn("rounded-md border px-2 py-0.5 text-[11px] font-medium", tone)}>
          {q.label} · {q.score}
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="min-h-[260px] flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-zinc-100 placeholder-zinc-600 outline-none"
        placeholder="Escribí el system prompt del agente o usá el generador con IA…"
      />
      <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-[11px] text-zinc-500">
        <span>{q.chars} chars</span>
        <span>~{q.tokens} tokens</span>
      </div>
    </div>
  );
}
