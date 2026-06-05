"use client";

import { motion } from "framer-motion";

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.5 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 0.61, 0.36, 1] } },
};

function Dot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
      )}
      <span
        className={`relative inline-flex h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-zinc-700"}`}
      />
    </span>
  );
}

const AGENTS = [
  { name: "Support", model: "claude-sonnet", active: true, conv: "847", accent: "#8b5cf6" },
  { name: "Analytics", model: "gpt-4o", active: true, conv: "1.2k", accent: "#3b82f6" },
  { name: "Sales", model: "claude-haiku", active: false, conv: "312", accent: "#06b6d4" },
];

// Layout: 3 × 130px cards + 2 × 15px gaps = 420px total
// Card centers: 65px, 210px, 355px
// Orchestrator (w-52 = 208px) centered in 420px → center at 210px

export function AgentOrgChart() {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="flex flex-col items-center"
      style={{ fontFamily: "var(--font-auth-mono), monospace" }}
    >
      {/* Orchestrator */}
      <motion.div
        variants={fadeUp}
        className="relative w-52 rounded-2xl border border-violet-500/30 bg-zinc-900/80 p-4 backdrop-blur-sm shadow-xl shadow-violet-500/10"
      >
        <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-violet-500/70 to-transparent" />
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-violet-500/25 bg-violet-600/20 text-sm font-bold text-violet-300">
            O
          </div>
          <div>
            <div
              className="text-xs font-bold text-zinc-100"
              style={{ fontFamily: "var(--font-syne), system-ui" }}
            >
              Orchestrator
            </div>
            <div className="text-[10px] text-zinc-600">claude-opus-4</div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Dot active={true} />
            <span className="text-[10px] text-zinc-500">Active</span>
          </div>
          <span className="text-[10px] text-violet-400">2.4k msgs</span>
        </div>
      </motion.div>

      {/* SVG connector lines */}
      <motion.svg variants={fadeUp} width="420" height="36" className="overflow-visible">
        {/* Drop from orchestrator center */}
        <line
          x1="210"
          y1="0"
          x2="210"
          y2="18"
          stroke="#27272a"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        {/* Horizontal bus */}
        <line
          x1="65"
          y1="18"
          x2="355"
          y2="18"
          stroke="#27272a"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        {/* Drops to each agent */}
        <line
          x1="65"
          y1="18"
          x2="65"
          y2="36"
          stroke="#27272a"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <line
          x1="210"
          y1="18"
          x2="210"
          y2="36"
          stroke="#27272a"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <line
          x1="355"
          y1="18"
          x2="355"
          y2="36"
          stroke="#27272a"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        {/* Junction dots */}
        <circle cx="65" cy="18" r="2.5" fill="#3f3f46" />
        <circle cx="210" cy="18" r="2.5" fill="#3f3f46" />
        <circle cx="355" cy="18" r="2.5" fill="#3f3f46" />
      </motion.svg>

      {/* Agent cards */}
      <div className="flex gap-[15px]">
        {AGENTS.map((agent) => (
          <motion.div
            key={agent.name}
            variants={fadeUp}
            className="relative w-[130px] rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3 backdrop-blur-sm"
          >
            <div
              className="absolute inset-x-0 top-0 h-px rounded-t-xl"
              style={{
                background: `linear-gradient(90deg, transparent, ${agent.accent}65, transparent)`,
              }}
            />
            <div className="mb-2 flex items-center gap-1.5">
              <Dot active={agent.active} />
              <span
                className="text-[11px] font-semibold text-zinc-200"
                style={{ fontFamily: "var(--font-syne), system-ui" }}
              >
                {agent.name}
              </span>
            </div>
            <div className="text-[10px] text-zinc-600">{agent.model}</div>
            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[10px] text-zinc-700">{agent.conv} convs</span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded-md ${
                  agent.active
                    ? "bg-emerald-500/10 text-emerald-500/70"
                    : "bg-zinc-800 text-zinc-600"
                }`}
              >
                {agent.active ? "online" : "idle"}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
