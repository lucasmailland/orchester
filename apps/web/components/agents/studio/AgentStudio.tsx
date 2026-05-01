"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { PromptEditor } from "./PromptEditor";
import { ModelPicker } from "./ModelPicker";
import { TestChat } from "./TestChat";
import { VersionHistory } from "./VersionHistory";
import { PromptGeneratorModal } from "./PromptGeneratorModal";
import { TemplatePickerModal } from "./TemplatePickerModal";

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
}

export function AgentStudio({ agent }: { agent: AgentDTO }) {
  const router = useRouter();
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [model, setModel] = useState(agent.model);
  const [temperature, setTemperature] = useState(
    agent.temperature ? Number(agent.temperature) : 0.7
  );
  const [maxTokens, setMaxTokens] = useState<number | undefined>(agent.maxTokens ?? undefined);
  const [tab, setTab] = useState<"config" | "versions">("config");
  const [genOpen, setGenOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  async function save() {
    setSaving(true);
    const r = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, role, systemPrompt, model, temperature, maxTokens }),
    });
    setSaving(false);
    if (r.ok) {
      setSavedAt(new Date());
      router.refresh();
    }
  }

  return (
    <>
      <div className="flex h-screen flex-col bg-black">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="text-zinc-400 hover:text-zinc-100"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-transparent text-sm font-medium text-zinc-100 outline-none focus:underline"
            />
            <span className="text-zinc-600">·</span>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="bg-transparent text-xs text-zinc-400 outline-none focus:underline"
            />
          </div>
          <div className="flex items-center gap-3">
            {savedAt && (
              <span className="text-[11px] text-zinc-500">
                Guardado {savedAt.toLocaleTimeString()}
              </span>
            )}
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
          <div className="flex w-[60%] flex-col gap-3 overflow-y-auto border-r border-white/[0.06] p-4">
            <div className="flex gap-1.5">
              {(["config", "versions"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={
                    tab === t
                      ? "rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100"
                      : "rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300"
                  }
                >
                  {t === "config" ? "Configuración" : "Versiones"}
                </button>
              ))}
            </div>

            {tab === "config" ? (
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
                    <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-zinc-500">
                      Modelo
                    </label>
                    <ModelPicker value={model} onChange={setModel} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-zinc-500">
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
                    <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-zinc-500">
                      Max tokens
                    </label>
                    <input
                      type="number"
                      value={maxTokens ?? ""}
                      onChange={(e) =>
                        setMaxTokens(e.target.value ? Number(e.target.value) : undefined)
                      }
                      placeholder="default"
                      className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2.5 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/60"
                    />
                  </div>
                </div>
              </>
            ) : (
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
