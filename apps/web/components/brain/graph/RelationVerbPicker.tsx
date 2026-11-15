"use client";
// A compact selector over the 9 LOCKED relation verbs. Each chip is tinted
// with the verb's EDGE_STYLES color so the picker matches the graph edges.
import { RELATION_VERBS, type RelationVerbLiteral } from "@/lib/mnemo/relation-verbs";
import { EDGE_STYLES, type EdgeStyle } from "@/lib/memory/graph-canvas";

export function RelationVerbPicker({
  value,
  onChange,
  label,
}: {
  value: RelationVerbLiteral | null;
  onChange: (v: RelationVerbLiteral) => void;
  label?: string;
}) {
  return (
    <div>
      {label && (
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">{label}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {RELATION_VERBS.map((verb) => {
          const style = (EDGE_STYLES as Record<string, EdgeStyle>)[verb] ?? EDGE_STYLES.related;
          const active = value === verb;
          return (
            <button
              key={verb}
              type="button"
              onClick={() => onChange(verb)}
              className={
                "px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors " +
                (active ? "text-white" : "text-zinc-300 hover:text-zinc-100")
              }
              style={{
                borderColor: active ? style.color : `${style.color}40`,
                backgroundColor: active ? style.color : `${style.color}14`,
              }}
            >
              {verb.replace(/_/g, " ")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
