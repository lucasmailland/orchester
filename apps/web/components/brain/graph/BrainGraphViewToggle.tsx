"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface Props {
  is3D: boolean;
  onChange: (v: boolean) => void;
}

// NOT self-positioned: BrainGraph wraps this in a container that slides left
// when the node-detail panel opens, so the toggle never gets covered.
export function BrainGraphViewToggle({ is3D, onChange }: Props) {
  const t = useTranslations("brain.graph");
  // 3D (WebGL force layout) is heavy and awkward on touch devices, so it's
  // disabled on coarse-pointer / narrow viewports. If we're already in 3D when
  // the viewport becomes mobile, drop back to 2D.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 767px)");
    const apply = () => {
      setIsMobile(mq.matches);
      if (mq.matches && is3D) onChange(false);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [is3D, onChange]);

  return (
    <div
      role="group"
      aria-label={t("viewMode")}
      className="flex bg-[#0c0c10]/90 border border-zinc-800/80 rounded-xl p-0.5 gap-0.5 backdrop-blur-xl shadow-lg shadow-black/40"
    >
      {(["2D", "3D"] as const).map((label) => {
        const wants3D = label === "3D";
        const active = wants3D ? is3D : !is3D;
        const disabled = wants3D && isMobile;
        return (
          <button
            key={label}
            onClick={() => !disabled && onChange(wants3D)}
            disabled={disabled}
            aria-pressed={active}
            title={disabled ? `${label} · ${t("viewMode")}` : label}
            className="px-3.5 py-1 text-xs font-semibold rounded-[10px] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={
              active
                ? { background: "#7c3aed", color: "white", boxShadow: "0 0 12px #7c3aed66" }
                : { color: "#71717a" }
            }
          >
            {wants3D ? t("toggle3d") : t("toggle2d")}
          </button>
        );
      })}
    </div>
  );
}
