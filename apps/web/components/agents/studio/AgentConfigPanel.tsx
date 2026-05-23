"use client";

import { useEffect, useState } from "react";
import { Bot, Workflow, Sparkles, Plus, Trash2, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface FlowOption {
  id: string;
  name: string;
}

interface ToolDef {
  id: string;
  label: string;
  description: string;
  emoji: string;
  category: string;
}

export interface AgentConfigState {
  kind: "conversational" | "flow";
  flowId: string | null;
  variables: Record<string, string>;
  tools: string[];
  greeting: string;
  fallback: string;
  starters: string[];
  avatarUrl: string;
  color: string;
  maxTurns: number;
  responseFormat: "text" | "json" | "markdown";
  outputSchema: string; // JSON string for editing
}

interface Props {
  value: AgentConfigState;
  onChange: (patch: Partial<AgentConfigState>) => void;
}

const COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
];

export function AgentConfigPanel({ value, onChange }: Props) {
  const t = useTranslations("pages.agents.studio.config");
  const [flows, setFlows] = useState<FlowOption[]>([]);
  const [tools, setTools] = useState<ToolDef[]>([]);

  useEffect(() => {
    fetch("/api/flows")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Array<{ id: string; name: string }>) =>
        setFlows((Array.isArray(d) ? d : []).map((f) => ({ id: f.id, name: f.name })))
      )
      .catch(() => setFlows([]));
    fetch("/api/tools")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setTools(Array.isArray(d) ? d : []))
      .catch(() => setTools([]));
  }, []);

  const toolsByCategory = tools.reduce<Record<string, ToolDef[]>>((acc, tool) => {
    (acc[tool.category] ||= []).push(tool);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {/* Kind selector */}
      <Section title={t("kindSectionTitle")} subtitle={t("kindSectionSubtitle")}>
        <div className="grid grid-cols-2 gap-2">
          <KindCard
            active={value.kind === "conversational"}
            onClick={() => onChange({ kind: "conversational" })}
            icon={<Bot className="h-4 w-4" />}
            title={t("kindConversational")}
            desc={t("kindConversationalHint")}
          />
          <KindCard
            active={value.kind === "flow"}
            onClick={() => onChange({ kind: "flow" })}
            icon={<Workflow className="h-4 w-4" />}
            title={t("kindFlow")}
            desc={t("kindFlowHint")}
          />
        </div>
        {value.kind === "flow" && (
          <div className="mt-3">
            <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
              {t("flowLabel")}
            </label>
            <select
              value={value.flowId ?? ""}
              onChange={(e) => onChange({ flowId: e.target.value || null })}
              className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
            >
              <option value="">{t("pickFlow")}</option>
              {flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {!value.flowId && (
              <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                {t("flowResponseHint")}
              </p>
            )}
          </div>
        )}
      </Section>

      {/* Tools (only for conversational) */}
      {value.kind === "conversational" && (
        <Section title={t("toolsSectionTitle")} subtitle={t("toolsSectionSubtitle")}>
          {tools.length === 0 ? (
            <div className="text-xs text-muted">{t("loading")}</div>
          ) : (
            <div className="space-y-3">
              {Object.entries(toolsByCategory).map(([cat, list]) => (
                <div key={cat}>
                  <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted">
                    {cat}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {list.map((tool) => {
                      const enabled = value.tools.includes(tool.id);
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() =>
                            onChange({
                              tools: enabled
                                ? value.tools.filter((id) => id !== tool.id)
                                : [...value.tools, tool.id],
                            })
                          }
                          className={cn(
                            "flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition",
                            enabled
                              ? "border-violet-500/40 bg-violet-500/10 text-strong"
                              : "border-line bg-card text-muted hover:bg-elevated"
                          )}
                        >
                          <span className="text-base leading-none">{tool.emoji}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{tool.label}</span>
                            <span className="line-clamp-2 text-[10px] text-muted">
                              {tool.description}
                            </span>
                          </span>
                          {enabled && (
                            <Wrench className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Variables */}
      <Section title={t("variablesSectionTitle")} subtitle={t("variablesSectionSubtitle")}>
        <VariablesEditor
          value={value.variables}
          onChange={(variables) => onChange({ variables })}
        />
      </Section>

      {/* Branding */}
      <Section title={t("brandingSectionTitle")} subtitle={t("brandingSectionSubtitle")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
              {t("colorLabel")}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={t("colorAria", { color: c })}
                  aria-pressed={value.color === c}
                  onClick={() => onChange({ color: c })}
                  className={cn(
                    "h-7 w-7 rounded-lg border-2",
                    value.color === c ? "border-white/60" : "border-transparent"
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
              {t("avatarLabel")}
            </label>
            <input
              value={value.avatarUrl}
              onChange={(e) => onChange({ avatarUrl: e.target.value })}
              placeholder="https://…"
              className="w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
            />
          </div>
        </div>
      </Section>

      {/* Conversation */}
      <Section title={t("conversationSectionTitle")} subtitle={t("conversationSectionSubtitle")}>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
              {t("greetingLabel")}
            </label>
            <input
              value={value.greeting}
              onChange={(e) => onChange({ greeting: e.target.value })}
              placeholder={t("greetingPlaceholder")}
              className="w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
              {t("fallbackLabel")}
            </label>
            <input
              value={value.fallback}
              onChange={(e) => onChange({ fallback: e.target.value })}
              placeholder={t("fallbackPlaceholder")}
              className="w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted">
              <span id="starters-label">{t("startersLabel")}</span>
              <button
                type="button"
                aria-label={t("addStarterAria")}
                onClick={() => onChange({ starters: [...value.starters, ""] })}
                className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300"
              >
                <Plus className="h-3 w-3" /> {t("addStarter")}
              </button>
            </div>
            <div className="space-y-1.5" aria-labelledby="starters-label">
              {value.starters.map((s, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    value={s}
                    aria-label={t("starterAria", { n: i + 1 })}
                    onChange={(e) => {
                      const next = [...value.starters];
                      next[i] = e.target.value;
                      onChange({ starters: next });
                    }}
                    placeholder={t("starterPlaceholder")}
                    className="flex-1 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
                  />
                  <button
                    type="button"
                    aria-label={t("deleteStarterAria", { n: i + 1 })}
                    onClick={() => onChange({ starters: value.starters.filter((_, j) => j !== i) })}
                    className="text-muted hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {value.starters.length === 0 && (
                <p className="text-[10px] text-faint">{t("noStarters")}</p>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
              {t("maxTurnsLabel")}
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={value.maxTurns}
              onChange={(e) => onChange({ maxTurns: Number(e.target.value) || 20 })}
              className="w-32 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-sm text-strong outline-none focus:border-violet-500/60"
            />
          </div>
        </div>
      </Section>

      {/* Response format */}
      <Section title={t("responseSectionTitle")} subtitle={t("responseSectionSubtitle")}>
        <div className="grid grid-cols-3 gap-1.5">
          {(["text", "json", "markdown"] as const).map((rf) => (
            <button
              key={rf}
              type="button"
              onClick={() => onChange({ responseFormat: rf })}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs font-medium transition",
                value.responseFormat === rf
                  ? "border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-200"
                  : "border-line text-muted hover:border-white/20"
              )}
            >
              {rf === "text"
                ? t("responseText")
                : rf === "json"
                  ? t("responseJson")
                  : t("responseMarkdown")}
            </button>
          ))}
        </div>
        {value.responseFormat === "json" && (
          <div className="mt-3">
            <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
              {t("outputSchemaLabel")}
            </label>
            <textarea
              value={value.outputSchema}
              onChange={(e) => onChange({ outputSchema: e.target.value })}
              rows={4}
              placeholder={t("outputSchemaPlaceholder")}
              className="w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 font-mono text-[11px] text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
            />
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
        <span className="text-sm font-semibold text-strong">{title}</span>
      </div>
      {subtitle && <p className="-mt-2 mb-3 text-[11px] text-muted">{subtitle}</p>}
      {children}
    </div>
  );
}

function KindCard({
  active,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border p-3 text-left transition",
        active
          ? "border-violet-500/40 bg-violet-500/10"
          : "border-line bg-card hover:border-white/20"
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 text-strong">
        {icon}
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-[11px] text-muted">{desc}</p>
    </button>
  );
}

function VariablesEditor({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const t = useTranslations("pages.agents.studio.config");
  const entries = Object.entries(value);
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={k}
            onChange={(e) => {
              const next = { ...value };
              delete next[k];
              next[e.target.value] = v;
              onChange(next);
            }}
            placeholder={t("variableNamePlaceholder")}
            className="w-1/3 rounded-lg border border-line bg-elevated px-2.5 py-1.5 font-mono text-xs text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
          />
          <span className="text-faint">=</span>
          <input
            value={v}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
            placeholder={t("variableValuePlaceholder")}
            className="flex-1 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
          />
          <button
            type="button"
            onClick={() => {
              const next = { ...value };
              delete next[k];
              onChange(next);
            }}
            className="text-muted hover:text-red-600 dark:hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...value, [`var_${entries.length + 1}`]: "" })}
        className="flex items-center gap-1 text-[11px] text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300"
      >
        <Plus className="h-3 w-3" /> {t("addVariable")}
      </button>
    </div>
  );
}
