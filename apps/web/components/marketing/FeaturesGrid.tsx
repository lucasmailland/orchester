"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import {
  MessagesSquare,
  Zap,
  Workflow,
  Wallet,
  KeyRound,
  Shield,
  MessageCircle,
  Send,
  Hash,
  Mail,
  Globe,
  Webhook,
  Check,
  type LucideIcon,
} from "lucide-react";
import { type MouseEvent } from "react";
import React from "react";
import { cn } from "@/lib/utils";

type FeatureKey = "multiChannel" | "streaming" | "flows" | "costControl" | "byok" | "enterprise";

const FEATURES: {
  key: FeatureKey;
  icon: LucideIcon;
  accent: string;
  hoverBg: string;
  iconBg: string;
  colSpan: "md:col-span-2" | "md:col-span-1";
}[] = [
  {
    key: "multiChannel",
    icon: MessagesSquare,
    accent: "text-violet-400",
    hoverBg: "from-violet-500/8",
    iconBg: "bg-violet-500/10 border-violet-500/20",
    colSpan: "md:col-span-2",
  },
  {
    key: "streaming",
    icon: Zap,
    accent: "text-cyan-400",
    hoverBg: "from-cyan-500/8",
    iconBg: "bg-cyan-500/10 border-cyan-500/20",
    colSpan: "md:col-span-1",
  },
  {
    key: "flows",
    icon: Workflow,
    accent: "text-indigo-400",
    hoverBg: "from-indigo-500/8",
    iconBg: "bg-indigo-500/10 border-indigo-500/20",
    colSpan: "md:col-span-1",
  },
  {
    key: "costControl",
    icon: Wallet,
    accent: "text-emerald-400",
    hoverBg: "from-emerald-500/8",
    iconBg: "bg-emerald-500/10 border-emerald-500/20",
    colSpan: "md:col-span-2",
  },
  {
    key: "byok",
    icon: KeyRound,
    accent: "text-amber-400",
    hoverBg: "from-amber-500/8",
    iconBg: "bg-amber-500/10 border-amber-500/20",
    colSpan: "md:col-span-1",
  },
  {
    key: "enterprise",
    icon: Shield,
    accent: "text-rose-400",
    hoverBg: "from-rose-500/8",
    iconBg: "bg-rose-500/10 border-rose-500/20",
    colSpan: "md:col-span-1",
  },
];

// ─── Per-feature mockup components ───────────────────────────────────────────

const CHANNELS: { Icon: LucideIcon; label: string; color: string }[] = [
  {
    Icon: MessageCircle,
    label: "WhatsApp",
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  { Icon: Send, label: "Telegram", color: "text-sky-400 bg-sky-500/10 border-sky-500/20" },
  { Icon: Hash, label: "Slack", color: "text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20" },
  { Icon: Mail, label: "Email", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  { Icon: Globe, label: "Widget", color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20" },
  {
    Icon: Webhook,
    label: "Webhook",
    color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
  },
];

function MultiChannelMockup() {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {CHANNELS.map(({ Icon, label, color }) => (
          <div
            key={label}
            className={cn("flex items-center gap-1.5 rounded-lg border px-2 py-1", color)}
          >
            <Icon size={11} />
            <span className="text-[10px] font-medium">{label}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <span className="text-[10px] text-zinc-600">1 context</span>
        <svg width="20" height="8" viewBox="0 0 20 8" className="text-zinc-600">
          <path
            d="M0 4 H16 M13 1 L19 4 L13 7"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5">
          <MessagesSquare size={9} className="text-violet-400" />
          <span className="text-[10px] text-violet-300">Unified conversation</span>
        </div>
      </div>
    </div>
  );
}

function StreamingMockup() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-[10px]">
      <div className="text-zinc-600">{">"} POST /v1/chat/stream</div>
      <div className="mt-1.5 text-zinc-400">
        <span className="text-zinc-600">HTTP/1.1 200 OK</span>
      </div>
      <div className="mt-1.5 text-zinc-300">
        Generating answer{" "}
        <motion.span
          animate={{ opacity: [1, 0.2, 1] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
          className="inline-block h-[11px] w-[5px] translate-y-[1px] bg-cyan-400 align-middle"
        />
      </div>
      <div className="mt-1 text-emerald-400/70">data: {`{"token":"Here"}`}</div>
      <div className="text-emerald-400/70">data: {`{"token":" is"}`}</div>
      <div className="text-emerald-400/70">data: {`{"token":" your"}`}</div>
      <div className="text-emerald-400/50">data: [DONE]</div>
    </div>
  );
}

function FlowsMockup() {
  const nodes = [
    { x: 10, color: "fill-amber-500/20 stroke-amber-500/50", label: "Trigger" },
    { x: 80, color: "fill-violet-500/20 stroke-violet-500/50", label: "Branch" },
    { x: 150, color: "fill-cyan-500/20 stroke-cyan-500/50", label: "Action" },
    { x: 220, color: "fill-emerald-500/20 stroke-emerald-500/50", label: "Reply" },
  ];

  return (
    <div className="space-y-1">
      <svg viewBox="0 0 250 80" className="h-20 w-full">
        <defs>
          <marker id="ar-feat" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,1 L5,3 L0,5" fill="#52525b" />
          </marker>
        </defs>
        {/* edges */}
        <path
          d="M 38 40 Q 60 20 76 40"
          stroke="#52525b"
          strokeWidth="1"
          fill="none"
          markerEnd="url(#ar-feat)"
        />
        <path
          d="M 108 40 Q 130 60 146 40"
          stroke="#52525b"
          strokeWidth="1"
          fill="none"
          markerEnd="url(#ar-feat)"
        />
        <path
          d="M 178 40 Q 200 20 216 40"
          stroke="#52525b"
          strokeWidth="1"
          fill="none"
          markerEnd="url(#ar-feat)"
        />
        {/* nodes */}
        {nodes.map((n) => (
          <g key={n.label}>
            <rect
              x={n.x}
              y={28}
              width={28}
              height={24}
              rx={5}
              className={n.color}
              strokeWidth="1"
            />
            <text
              x={n.x + 14}
              y={43}
              textAnchor="middle"
              className="fill-zinc-400"
              fontSize="5"
              fontFamily="monospace"
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function CostControlMockup() {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-base font-bold text-zinc-100">$19.20</span>
        <span className="text-[10px] text-zinc-500">of $50 budget</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full w-[38%] rounded-full bg-gradient-to-r from-violet-500 to-cyan-400" />
      </div>
      <svg viewBox="0 0 240 50" className="h-10 w-full">
        <defs>
          <linearGradient id="sl-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline
          points="0,30 18,22 36,28 54,18 72,24 90,15 108,22 126,12 144,20 162,10 180,18 198,8 216,16 234,6"
          fill="none"
          stroke="#a78bfa"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <polygon
          points="0,30 18,22 36,28 54,18 72,24 90,15 108,22 126,12 144,20 162,10 180,18 198,8 216,16 234,6 234,50 0,50"
          fill="url(#sl-grad)"
        />
      </svg>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
        <span className="text-zinc-300">Anthropic $11.20</span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-300">OpenAI $5.80</span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-300">Google $2.00</span>
      </div>
    </div>
  );
}

const PROVIDERS: { abbr: string; name: string; color: string }[] = [
  {
    abbr: "ANT",
    name: "Anthropic",
    color: "text-orange-400 bg-orange-500/[0.08] border-orange-500/20",
  },
  {
    abbr: "OAI",
    name: "OpenAI",
    color: "text-emerald-400 bg-emerald-500/[0.08] border-emerald-500/20",
  },
  { abbr: "GEM", name: "Gemini", color: "text-blue-400 bg-blue-500/[0.08] border-blue-500/20" },
  {
    abbr: "MIS",
    name: "Mistral",
    color: "text-violet-400 bg-violet-500/[0.08] border-violet-500/20",
  },
  { abbr: "LLA", name: "Llama", color: "text-amber-400 bg-amber-500/[0.08] border-amber-500/20" },
  { abbr: "···", name: "+75 more", color: "text-zinc-500 bg-zinc-800/40 border-zinc-700/50" },
];

function ByokMockup() {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {PROVIDERS.map((p) => (
        <div
          key={p.abbr}
          className={cn("flex items-center gap-1.5 rounded-lg border px-1.5 py-1", p.color)}
        >
          <span className="font-mono text-[10px] font-bold">{p.abbr}</span>
          <span className="truncate text-[10px] text-zinc-400">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

const BADGES = ["SSO/SAML", "2FA", "RBAC", "Audit log", "GDPR export", "Encrypt at-rest"];

function EnterpriseMockup() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {BADGES.map((label) => (
        <div
          key={label}
          className="flex items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-1.5 py-1 text-[10px] text-zinc-300"
        >
          <Check size={9} className="text-emerald-400" />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

const MOCKUPS: Record<FeatureKey, () => React.ReactElement> = {
  multiChannel: MultiChannelMockup,
  streaming: StreamingMockup,
  flows: FlowsMockup,
  costControl: CostControlMockup,
  byok: ByokMockup,
  enterprise: EnterpriseMockup,
};

// ─── Main component ───────────────────────────────────────────────────────────

export function FeaturesGrid() {
  const t = useTranslations("marketing.features");

  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t("title")} <span className="text-zinc-500">{t("subtitle")}</span>
          </h2>
        </motion.div>

        {/* Bento grid */}
        <div className="grid auto-rows-[minmax(300px,auto)] grid-cols-1 gap-4 md:grid-cols-3">
          {FEATURES.map(({ key, icon: Icon, accent, hoverBg, iconBg, colSpan }, i) => {
            const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
              const rect = e.currentTarget.getBoundingClientRect();
              e.currentTarget.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
              e.currentTarget.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
            };

            const Mockup = MOCKUPS[key];

            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: i * 0.07, duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
                onMouseMove={handleMouseMove}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6",
                  "transition-all duration-300 hover:border-zinc-700 hover:bg-zinc-900/60",
                  colSpan
                )}
              >
                {/* Spotlight layer — follows cursor */}
                <div
                  className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    background:
                      "radial-gradient(400px circle at var(--mouse-x) var(--mouse-y), rgba(167, 139, 250, 0.10), transparent 60%)",
                  }}
                />

                {/* Hover gradient */}
                <div
                  className={cn(
                    "absolute inset-0 bg-gradient-to-br to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100",
                    hoverBg
                  )}
                />

                <div className="relative z-10 flex h-full flex-col">
                  <div
                    className={cn(
                      "mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border",
                      iconBg,
                      accent
                    )}
                  >
                    <Icon size={16} />
                  </div>
                  <h3 className="mb-1.5 font-display text-base font-semibold text-zinc-100">
                    {(t as (k: string) => string)(`${key}.title`)}
                  </h3>
                  <p className="mb-4 text-sm leading-relaxed text-zinc-500">
                    {(t as (k: string) => string)(`${key}.desc`)}
                  </p>
                  <div className="mt-auto">
                    <Mockup />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
