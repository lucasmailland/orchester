"use client";

interface Props {
  is3D: boolean;
  onChange: (v: boolean) => void;
}

export function BrainGraphViewToggle({ is3D, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="absolute top-4 right-4 z-10 flex bg-[#111113f2] border border-zinc-800 rounded-lg overflow-hidden backdrop-blur-md"
    >
      {(["2D", "3D"] as const).map((label) => {
        const active = label === "3D" ? is3D : !is3D;
        return (
          <button
            key={label}
            onClick={() => onChange(label === "3D")}
            aria-pressed={active}
            className="px-3.5 py-1.5 text-xs font-semibold transition-all"
            style={active ? { background: "#7c3aed", color: "white" } : { color: "#71717a" }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
