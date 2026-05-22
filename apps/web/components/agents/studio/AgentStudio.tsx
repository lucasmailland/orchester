"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Loader2, Workflow as WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { PromptEditor } from "./PromptEditor";
import { ModelPicker } from "./ModelPicker";
import { TestChat } from "./TestChat";
import { VersionHistory } from "./VersionHistory";
import { PromptGeneratorModal } from "./PromptGeneratorModal";
import { TemplatePickerModal } from "./TemplatePickerModal";
import { AgentConfigPanel, type AgentConfigState } from "./AgentConfigPanel";
import { MemoryPanel } from "./MemoryPanel";

interface AgentDTO {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model: string;
  status: string;
  temperature: string | number | null;
  maxTokens: number | null;
  teamId: string | null;
  kind: "conversational" | "flow";
  flowId: string | null;
  tools: string[] | null;
  variables: Record<string, string> | null;
  greeting: string | null;
  fallback: string | null;
  starters: string[] | null;
  avatarUrl: string | null;
  color: string | null;
  maxTurns: number | null;
  responseFormat: "text" | "json" | "markdown";
  outputSchema: Record<string, unknown> | null;
}

type Tab = "config" | "advanced" | "versions";

export function AgentStudio({ agent }: { agent: AgentDTO }) {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "es";
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [model, setModel] = useState(agent.model);
  const [temperature, setTemperature] = useState(
    agent.temperature ? Number(agent.temperature) : 0.7
  );
  const [maxTokens, setMaxTokens] = useState<number | undefined>(agent.maxTokens ?? undefined);
  const [config, setConfig] = useState<AgentConfigState>({
    kind: agent.kind,
    flowId: agent.flowId,
    variables: agent.variables ?? {},
    tools: agent.tools ?? [],
    greeting: agent.greeting ?? "",
    fallback: agent.fallback ?? "",
    starters: agent.starters ?? [],
    avatarUrl: agent.avatarUrl ?? "",
    color: agent.color ?? "#8b5cf6",
    maxTurns: agent.maxTurns ?? 20,
    responseFormat: agent.responseFormat,
    outputSchema: agent.outputSchema ? JSON.stringify(agent.outputSchema, null, 2) : "",
  });
  const [tab, setTab] = useState<Tab>("config");
  const [genOpen, setGenOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  function patchConfig(p: Partial<AgentConfigState>) {
    setConfig((c) => ({ ...c, ...p }));
  }

  async function save() {
    setSaving(true);
    let parsedOutputSchema: Record<string, unknown> | null = null;
    if (config.responseFormat === "json" && config.outputSchema.trim()) {
      try {
        parsedOutputSchema = JSON.parse(config.outputSchema);
      } catch {
        toast.error("El JSON Schema no es válido");
        setSaving(false);
        return;
      }
    }
    const r = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        role,
        systemPrompt,
        model,
        temperature,
        maxTokens,
        kind: config.kind,
        flowId: config.flowId,
        tools: config.tools,
        variables: config.variables,
        greeting: config.greeting,
        fallback: config.fallback,
        starters: config.starters,
        avatarUrl: config.avatarUrl,
        color: config.color,
        maxTurns: config.maxTurns,
        responseFormat: config.responseFormat,
        outputSchema: parsedOutputSchema,
      }),
    });
    setSaving(false);
    if (r.ok) {
      toast.success("Agente guardado");
      router.refresh();
    } else {
      toast.error("No se pudo guardar");
    }
  }

  const isFlowKind = config.kind === "flow";

  return (
    <>
      <div className="flex h-screen flex-col bg-app">
        <div className="flex items-center justify-between border-b border-line px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="text-muted hover:text-strong"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
              style={{ background: config.color }}
            >
              {config.avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={config.avatarUrl} alt="" className="h-full w-full rounded-lg object-cover" />
              ) : (
                <span className="text-[11px] font-bold">
                  {name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-transparent text-sm font-medium text-strong outline-none focus:underline"
            />
            <span className="text-faint">·</span>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="bg-transparent text-xs text-muted outline-none focus:underline"
            />
            <span
              className={
                isFlowKind
                  ? "ml-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300"
                  : "ml-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-violet-700 dark:text-violet-300"
              }
            >
              {isFlowKind ? "flow" : "conversacional"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Guardar
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex w-[60%] flex-col gap-3 overflow-y-auto border-r border-line p-4">
            <div className="flex gap-1.5">
              {(["config", "advanced", "versions"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={
                    tab === t
                      ? "rounded-lg bg-elevated px-3 py-1.5 text-xs text-strong"
                      : "rounded-lg px-3 py-1.5 text-xs text-muted hover:text-body"
                  }
                >
                  {t === "config" ? "Prompt + Modelo" : t === "advanced" ? "Avanzado" : "Versiones"}
                </button>
              ))}
            </div>

            {tab === "config" && (
              <>
                {isFlowKind ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 text-sm">
                    <div className="mb-2 flex items-center gap-2 text-amber-700 dark:text-amber-300">
                      <WorkflowIcon className="h-4 w-4" />
                      <span className="font-medium">Agente driven by flow</span>
                    </div>
                    <p className="text-xs text-muted">
                      Este agente no usa prompt. Cada mensaje ejecuta el flujo seleccionado en la
                      pestaña <strong>Avanzado</strong>.
                    </p>
                    {config.flowId ? (
                      <Link
                        href={`/${locale}/flows/${config.flowId}`}
                        className="mt-3 inline-block rounded-lg border border-amber-500/30 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                      >
                        Editar el flujo →
                      </Link>
                    ) : (
                      <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                        ⚠ Ningún flujo seleccionado. Andá a <strong>Avanzado</strong> y elegí uno.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-h-[300px]">
                      <PromptEditor
                        value={systemPrompt}
                        onChange={setSystemPrompt}
                        onGenerate={() => setGenOpen(true)}
                        onTemplates={() => setTplOpen(true)}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
                          Modelo
                        </label>
                        <ModelPicker value={model} onChange={setModel} />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
                          Temperature: {temperature.toFixed(2)}
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={temperature}
                          onChange={(e) => setTemperature(Number(e.target.value))}
                          className="w-full accent-violet-500"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
                          Max tokens
                        </label>
                        <input
                          type="number"
                          value={maxTokens ?? ""}
                          onChange={(e) =>
                            setMaxTokens(e.target.value ? Number(e.target.value) : undefined)
                          }
                          placeholder="default"
                          className="w-full rounded-lg border border-line bg-elevated px-2.5 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
                        />
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {tab === "advanced" && (
              <div className="space-y-4">
                <AgentConfigPanel value={config} onChange={patchConfig} />
                <MemoryPanel agentId={agent.id} />
              </div>
            )}

            {tab === "versions" && (
              <VersionHistory
                agentId={agent.id}
                current={{ systemPrompt, model, temperature, maxTokens }}
                onRestored={() => router.refresh()}
              />
            )}
          </div>

          <div className="w-[40%] overflow-hidden p-4">
            <TestChat
              agentId={agent.id}
              systemPrompt={systemPrompt}
              model={model}
              temperature={temperature}
              maxTokens={maxTokens}
              variables={config.variables}
              tools={config.tools}
            />
          </div>
        </div>
      </div>

      <PromptGeneratorModal
        open={genOpen}
        agentId={agent.id}
        onClose={() => setGenOpen(false)}
        onPick={(p) => setSystemPrompt(p)}
      />
      <TemplatePickerModal
        open={tplOpen}
        onClose={() => setTplOpen(false)}
        onPick={(t) => {
          setSystemPrompt(t.systemPrompt);
          setModel(t.suggestedModel);
          setTemperature(t.suggestedTemperature);
        }}
      />
    </>
  );
}
