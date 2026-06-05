"use client";

const NODE_LEGEND = [
  { color: "#7c3aed", label: "Person" },
  { color: "#2563eb", label: "Org" },
  { color: "#16a34a", label: "Project" },
  { color: "#d97706", label: "Concept" },
  { color: "#0e7490", label: "Episode" },
];

const EDGE_LEGEND = [
  { color: "#7c3aed", dashed: false, label: "related" },
  { color: "#dc2626", dashed: true, label: "conflict" },
  { color: "#52525b", dashed: true, label: "derived" },
];

export function BrainGraphLegend() {
  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-3 bg-[#111113f2] backdrop-blur-md border border-zinc-800 rounded-lg px-3 py-2 text-[11px] text-zinc-400 flex-wrap">
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Nodes</span>
      {NODE_LEGEND.map(({ color, label }) => (
        <span key={label} className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          {label}
        </span>
      ))}
      <span className="w-px h-3.5 bg-zinc-700" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Edges</span>
      {EDGE_LEGEND.map(({ color, dashed, label }) => (
        <span key={label} className="flex items-center gap-1">
          <span
            className="inline-block w-4"
            style={{
              height: "1.5px",
              background: dashed ? "none" : color,
              borderTop: dashed ? `2px dashed ${color}` : "none",
            }}
          />
          {label}
        </span>
      ))}
      <span className="w-px h-3.5 bg-zinc-700" />
      <span className="flex items-center gap-1">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ background: "radial-gradient(circle, #a78bfa40, transparent)" }}
        />
        Memory aura
      </span>
    </div>
  );
}
