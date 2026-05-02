"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createId } from "@paralleldrive/cuid2";
import { AgentNode } from "./nodes/AgentNode";
import { ConditionNode } from "./nodes/ConditionNode";
import { HttpNode } from "./nodes/HttpNode";
import { TriggerNode } from "./nodes/TriggerNode";
import { FlowRunsPanel } from "./FlowRunsPanel";
import { Save, Play, Loader2, History, ArrowLeft, Variable, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const nodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  condition: ConditionNode,
  switch: ConditionNode,
  http: HttpNode,
  transform: AgentNode,
  delay: AgentNode,
  notify: AgentNode,
  code: AgentNode,
  loop_for_each: ConditionNode,
  parallel: AgentNode,
  try_catch: ConditionNode,
  subflow: AgentNode,
  wait_human: AgentNode,
};

interface FlowDTO {
  id: string;
  name: string;
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    config: Record<string, unknown>;
    position: { x: number; y: number };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    label?: string;
  }>;
  variables?: Record<string, unknown>;
}

export function FlowBuilder({ flow }: { flow: FlowDTO }) {
  const router = useRouter();
  const [nodes, setNodes] = useState<Node[]>(
    flow.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { label: n.label, subtitle: subtitleFor(n), config: n.config },
    }))
  );
  const [edges, setEdges] = useState<Edge[]>(
    flow.edges.map((e) => {
      const edge: Edge = { id: e.id, source: e.source, target: e.target };
      if (e.sourceHandle) edge.sourceHandle = e.sourceHandle;
      if (e.label) edge.label = e.label;
      return edge;
    })
  );
  const [selected, setSelected] = useState<Node | null>(null);
  const [variables, setVariables] = useState<Record<string, unknown>>(flow.variables ?? {});
  const [varsOpen, setVarsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextAutoSaveRef = useRef(true); // skip on first render
  const dirtyRef = useRef(false);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );
  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: createId() }, eds)),
    []
  );

  function addNode(type: string) {
    const id = createId();
    setNodes((nds) => [
      ...nds,
      {
        id,
        type,
        position: { x: 350 + Math.random() * 100, y: 200 + Math.random() * 100 },
        data: { label: defaultLabel(type), config: {} },
      },
    ]);
  }

  const buildPayload = useCallback(
    () => ({
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: (n.data as { label: string }).label,
        config: (n.data as { config?: Record<string, unknown> }).config ?? {},
        position: n.position,
      })),
      edges: edges.map((e) => {
        const out: Record<string, unknown> = { id: e.id, source: e.source, target: e.target };
        if (e.sourceHandle) out.sourceHandle = e.sourceHandle;
        if (typeof e.label === "string") out.label = e.label;
        return out;
      }),
      variables,
    }),
    [nodes, edges, variables]
  );

  async function save({ silent }: { silent?: boolean } = {}) {
    if (!silent) setSaving(true);
    if (silent) setAutoSaveStatus("saving");
    setFeedback(null);
    const r = await fetch(`/api/flows/${flow.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    if (!silent) setSaving(false);
    if (r.ok) {
      dirtyRef.current = false;
      if (silent) setAutoSaveStatus("saved");
      else toast.success("Flujo guardado");
    } else {
      if (silent) setAutoSaveStatus("error");
      else toast.error("No se pudo guardar el flujo");
    }
  }

  // Auto-save with 2s debounce after any change
  useEffect(() => {
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    dirtyRef.current = true;
    setAutoSaveStatus("idle");
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      save({ silent: true });
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, variables]);

  async function run() {
    setRunning(true);
    setFeedback(null);
    const r = await fetch(`/api/flows/${flow.id}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: {} }),
    });
    setRunning(false);
    const j = await r.json();
    if (j.status === "succeeded") toast.success("Ejecución completada");
    else toast.error(`Ejecución ${j.status}${j.error ? `: ${j.error}` : ""}`);
    if (runsOpen) setRunsOpen(false);
    setTimeout(() => setRunsOpen(true), 300);
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-screen flex-col bg-black text-zinc-100">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="text-zinc-400 hover:text-zinc-100"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">{flow.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {feedback && <span className="text-[11px] text-zinc-400">{feedback}</span>}
            {autoSaveStatus !== "idle" && (
              <span
                className={
                  autoSaveStatus === "saving"
                    ? "text-[11px] text-zinc-500"
                    : autoSaveStatus === "error"
                    ? "text-[11px] text-red-400"
                    : "text-[11px] text-emerald-400"
                }
              >
                {autoSaveStatus === "saving"
                  ? "Guardando…"
                  : autoSaveStatus === "error"
                  ? "Error al guardar"
                  : "Auto-guardado"}
              </span>
            )}
            <button
              type="button"
              onClick={() => setVarsOpen((o) => !o)}
              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
              title="Variables del flujo"
            >
              <Variable className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setRunsOpen((o) => !o)}
              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
              title="Historial de ejecuciones"
            >
              <History className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => save()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-40"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}{" "}
              Guardar
            </button>
            <button
              type="button"
              onClick={run}
              disabled={running}
              className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium hover:bg-violet-400 disabled:opacity-40"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}{" "}
              Ejecutar
            </button>
          </div>
        </div>
        <div className="relative flex flex-1 overflow-hidden">
          <Sidebar onAdd={addNode} />
          {varsOpen && (
            <VariablesPanel
              variables={variables}
              onChange={setVariables}
              onClose={() => setVarsOpen(false)}
            />
          )}
          <div className="flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSelected(n)}
              onPaneClick={() => setSelected(null)}
              nodeTypes={nodeTypes}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#27272a" gap={20} />
              <Controls className="!border-white/10 !bg-zinc-900" />
              <MiniMap pannable zoomable className="!border-white/10 !bg-zinc-900" />
            </ReactFlow>
          </div>
          <Inspector
            node={selected}
            onChange={(updated) => {
              setNodes((nds) => nds.map((n) => (n.id === updated.id ? updated : n)));
              setSelected(updated);
            }}
            onDelete={(id) => {
              setNodes((nds) => nds.filter((n) => n.id !== id));
              setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
              setSelected(null);
            }}
          />
          <FlowRunsPanel
            flowId={flow.id}
            open={runsOpen}
            onClose={() => setRunsOpen(false)}
          />
        </div>
      </div>
    </ReactFlowProvider>
  );
}

function defaultLabel(type: string): string {
  const map: Record<string, string> = {
    trigger: "Inicio",
    agent: "Agente",
    condition: "Condición",
    switch: "Switch",
    http: "HTTP",
    transform: "Transformar",
    delay: "Esperar",
    notify: "Notificar",
    code: "Código",
    loop_for_each: "Loop foreach",
    parallel: "Paralelo",
    try_catch: "Try / Catch",
    subflow: "Subflujo",
    wait_human: "Esperar aprobación",
  };
  return map[type] ?? type;
}

function subtitleFor(n: { type: string; config: Record<string, unknown> }): string {
  if (n.type === "agent" && n.config.agentId)
    return `agentId: ${(n.config.agentId as string).slice(0, 8)}`;
  if (n.type === "http" && n.config.url) return String(n.config.url).slice(0, 32);
  return "";
}

function Sidebar({ onAdd }: { onAdd: (type: string) => void }) {
  const groups: Array<{ heading: string; items: { id: string; label: string; emoji: string }[] }> = [
    {
      heading: "AI",
      items: [
        { id: "agent", label: "Agente", emoji: "🤖" },
        { id: "subflow", label: "Subflujo", emoji: "🧩" },
      ],
    },
    {
      heading: "Lógica",
      items: [
        { id: "condition", label: "Condición", emoji: "🔀" },
        { id: "switch", label: "Switch", emoji: "🎚" },
        { id: "loop_for_each", label: "Loop", emoji: "🔁" },
        { id: "parallel", label: "Paralelo", emoji: "🪢" },
        { id: "try_catch", label: "Try/Catch", emoji: "🛟" },
        { id: "code", label: "Código", emoji: "💻" },
      ],
    },
    {
      heading: "Datos",
      items: [
        { id: "http", label: "HTTP", emoji: "🌐" },
        { id: "transform", label: "Transformar", emoji: "🔧" },
      ],
    },
    {
      heading: "Acciones",
      items: [
        { id: "delay", label: "Esperar", emoji: "⏱" },
        { id: "wait_human", label: "Aprobación", emoji: "🙋" },
        { id: "notify", label: "Notificar", emoji: "📨" },
      ],
    },
  ];
  return (
    <div className="w-48 overflow-y-auto border-r border-white/[0.06] bg-zinc-950 p-3">
      {groups.map((g) => (
        <div key={g.heading} className="mb-3">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            {g.heading}
          </div>
          {g.items.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onAdd(t.id)}
              className="mb-1 flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-zinc-900/40 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/60"
            >
              <span>{t.emoji}</span> {t.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function Inspector({
  node,
  onChange,
  onDelete,
}: {
  node: Node | null;
  onChange: (n: Node) => void;
  onDelete: (id: string) => void;
}) {
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setAgents(Array.isArray(d) ? d : []))
      .catch(() => setAgents([]));
  }, []);

  if (!node) {
    return (
      <div className="w-72 border-l border-white/[0.06] bg-zinc-950 p-4 text-xs text-zinc-500">
        Seleccioná un nodo para configurarlo.
      </div>
    );
  }

  const data = node.data as { label: string; config?: Record<string, unknown> };
  const config = data.config ?? {};

  function update(patch: Partial<{ label: string; config: Record<string, unknown> }>) {
    onChange({
      ...node!,
      data: { ...data, ...patch, config: { ...config, ...(patch.config ?? {}) } },
    });
  }

  return (
    <div className="w-72 space-y-3 overflow-y-auto border-l border-white/[0.06] bg-zinc-950 p-4 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {node.type}
        </span>
        <button
          type="button"
          onClick={() => onDelete(node.id)}
          className="text-red-400 hover:text-red-300"
        >
          Eliminar
        </button>
      </div>
      <input
        value={data.label}
        onChange={(e) => update({ label: e.target.value })}
        className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2.5 py-1.5 text-zinc-100 outline-none focus:border-violet-500/60"
      />

      {node.type === "agent" && (
        <>
          <label className="block text-zinc-500">Agente</label>
          <select
            value={(config.agentId as string) ?? ""}
            onChange={(e) => update({ config: { agentId: e.target.value } })}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          >
            <option value="">— elegir —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <label className="block text-zinc-500">Mensaje (template)</label>
          <textarea
            value={(config.message as string) ?? ""}
            onChange={(e) => update({ config: { message: e.target.value } })}
            placeholder="Hola {{nombre}}, …"
            rows={3}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-violet-500/60"
          />
          <label className="block text-zinc-500">Output var</label>
          <input
            value={(config.outputVar as string) ?? ""}
            onChange={(e) => update({ config: { outputVar: e.target.value } })}
            placeholder="agentResult"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          />
        </>
      )}

      {node.type === "condition" && (
        <>
          <label className="block text-zinc-500">left</label>
          <input
            value={((config.condition as { left?: string })?.left) ?? ""}
            onChange={(e) =>
              update({
                config: {
                  condition: { ...((config.condition as object) ?? {}), left: e.target.value },
                },
              })
            }
            placeholder="{{score}}"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
          />
          <label className="block text-zinc-500">op</label>
          <select
            value={((config.condition as { op?: string })?.op) ?? "=="}
            onChange={(e) =>
              update({
                config: {
                  condition: { ...((config.condition as object) ?? {}), op: e.target.value },
                },
              })
            }
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          >
            {["==", "!=", ">", "<", ">=", "<=", "contains"].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <label className="block text-zinc-500">right</label>
          <input
            value={((config.condition as { right?: string })?.right) ?? ""}
            onChange={(e) =>
              update({
                config: {
                  condition: { ...((config.condition as object) ?? {}), right: e.target.value },
                },
              })
            }
            placeholder="50"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
          />
        </>
      )}

      {node.type === "http" && (
        <>
          <label className="block text-zinc-500">Method</label>
          <select
            value={(config.method as string) ?? "GET"}
            onChange={(e) => update({ config: { method: e.target.value } })}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          >
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <label className="block text-zinc-500">URL</label>
          <input
            value={(config.url as string) ?? ""}
            onChange={(e) => update({ config: { url: e.target.value } })}
            placeholder="https://api.example.com/{{id}}"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
          />
          <label className="block text-zinc-500">Auth</label>
          <select
            value={((config.auth as { kind?: string })?.kind) ?? "none"}
            onChange={(e) => {
              const kind = e.target.value;
              update({
                config: {
                  auth: kind === "none" ? undefined : { ...((config.auth as object) ?? {}), kind },
                },
              });
            }}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          >
            <option value="none">Sin auth</option>
            <option value="bearer">Bearer token</option>
            <option value="basic">Basic auth</option>
            <option value="api_key">API key (header)</option>
          </select>
          {((config.auth as { kind?: string })?.kind) === "bearer" && (
            <input
              value={((config.auth as { token?: string })?.token) ?? ""}
              onChange={(e) =>
                update({ config: { auth: { ...((config.auth as object) ?? {}), token: e.target.value } } })
              }
              placeholder="Token o {{var}}"
              className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
            />
          )}
          {((config.auth as { kind?: string })?.kind) === "basic" && (
            <>
              <input
                value={((config.auth as { user?: string })?.user) ?? ""}
                onChange={(e) =>
                  update({ config: { auth: { ...((config.auth as object) ?? {}), user: e.target.value } } })
                }
                placeholder="user"
                className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
              />
              <input
                value={((config.auth as { pass?: string })?.pass) ?? ""}
                onChange={(e) =>
                  update({ config: { auth: { ...((config.auth as object) ?? {}), pass: e.target.value } } })
                }
                placeholder="pass o {{var}}"
                className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
              />
            </>
          )}
          {((config.auth as { kind?: string })?.kind) === "api_key" && (
            <>
              <input
                value={((config.auth as { header?: string })?.header) ?? "X-API-Key"}
                onChange={(e) =>
                  update({ config: { auth: { ...((config.auth as object) ?? {}), header: e.target.value } } })
                }
                placeholder="X-API-Key"
                className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
              />
              <input
                value={((config.auth as { key?: string })?.key) ?? ""}
                onChange={(e) =>
                  update({ config: { auth: { ...((config.auth as object) ?? {}), key: e.target.value } } })
                }
                placeholder="API key o {{var}}"
                className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
              />
            </>
          )}
          <label className="block text-zinc-500">Body (JSON, opcional)</label>
          <textarea
            value={(config.body as string) ?? ""}
            onChange={(e) => update({ config: { body: e.target.value } })}
            rows={3}
            placeholder='{ "key": "{{var}}" }'
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-violet-500/60"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-zinc-500">Reintentos</label>
              <input
                type="number"
                min={1}
                max={5}
                value={(config.maxAttempts as number) ?? 1}
                onChange={(e) => update({ config: { maxAttempts: Number(e.target.value) } })}
                className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
              />
            </div>
            <div>
              <label className="block text-zinc-500">Timeout (ms)</label>
              <input
                type="number"
                min={1000}
                max={60000}
                step={1000}
                value={(config.timeoutMs as number) ?? 30000}
                onChange={(e) => update({ config: { timeoutMs: Number(e.target.value) } })}
                className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
              />
            </div>
          </div>
          <label className="block text-zinc-500">Output var</label>
          <input
            value={(config.outputVar as string) ?? ""}
            onChange={(e) => update({ config: { outputVar: e.target.value } })}
            placeholder="httpResult"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          />
        </>
      )}

      {node.type === "transform" && (
        <>
          <label className="block text-zinc-500">Variable destino</label>
          <input
            value={(config.target as string) ?? ""}
            onChange={(e) => update({ config: { target: e.target.value } })}
            placeholder="result"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
          />
          <label className="block text-zinc-500">Valor (template)</label>
          <textarea
            value={(config.value as string) ?? ""}
            onChange={(e) => update({ config: { value: e.target.value } })}
            placeholder="Hola {{nombre}}"
            rows={2}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-violet-500/60"
          />
        </>
      )}

      {node.type === "delay" && (
        <>
          <label className="block text-zinc-500">ms</label>
          <input
            type="number"
            value={(config.ms as number) ?? 1000}
            onChange={(e) => update({ config: { ms: Number(e.target.value) } })}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          />
        </>
      )}

      {node.type === "code" && (
        <>
          <label className="block text-zinc-500">Source (DSL)</label>
          <textarea
            value={(config.source as string) ?? ""}
            onChange={(e) => update({ config: { source: e.target.value } })}
            rows={6}
            placeholder={`set total = {{score}}\nset greeting = "hola {{nombre}}"`}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-violet-500/60"
          />
          <p className="text-[10px] text-zinc-600">
            Sintaxis: <code>set var = expr</code> con interpolación <code>{`{{var}}`}</code>. Una línea por sentencia.
          </p>
        </>
      )}

      {node.type === "loop_for_each" && (
        <>
          <label className="block text-zinc-500">Variable array</label>
          <input
            value={(config.arrayVar as string) ?? ""}
            onChange={(e) => update({ config: { arrayVar: e.target.value } })}
            placeholder="items"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
          />
          <label className="block text-zinc-500">Variable item</label>
          <input
            value={(config.itemVar as string) ?? "item"}
            onChange={(e) => update({ config: { itemVar: e.target.value } })}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
          />
          <p className="text-[10px] text-zinc-600">
            Conectá el handle <code>body</code> al primer nodo del loop.
          </p>
        </>
      )}

      {node.type === "parallel" && (
        <p className="text-[11px] text-zinc-500">
          Conectá múltiples nodos como hijos. Se ejecutan en paralelo y el flujo continúa cuando todos terminan.
        </p>
      )}

      {node.type === "try_catch" && (
        <>
          <label className="block text-zinc-500">Variable error</label>
          <input
            value={(config.errorVar as string) ?? "error"}
            onChange={(e) => update({ config: { errorVar: e.target.value } })}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
          />
          <p className="text-[10px] text-zinc-600">
            Usá los handles <code>try</code> y <code>catch</code> para conectar las dos ramas.
          </p>
        </>
      )}

      {node.type === "switch" && (
        <>
          <label className="block text-zinc-500">Expresión</label>
          <input
            value={(config.expression as string) ?? ""}
            onChange={(e) => update({ config: { expression: e.target.value } })}
            placeholder="{{tipo}}"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
          />
          <p className="text-[10px] text-zinc-600">
            Cada edge saliente debe tener un <code>sourceHandle</code> con el valor a matchear, o <code>default</code>.
          </p>
        </>
      )}

      {node.type === "subflow" && (
        <SubflowPicker
          currentFlowId={(config.flowId as string) ?? ""}
          onChange={(id) => update({ config: { flowId: id } })}
        />
      )}

      {node.type === "wait_human" && (
        <>
          <label className="block text-zinc-500">Mensaje</label>
          <input
            value={(config.message as string) ?? ""}
            onChange={(e) => update({ config: { message: e.target.value } })}
            placeholder="Aprobar pedido {{id}}"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
          />
          <label className="block text-zinc-500">Asignado a (email)</label>
          <input
            value={(config.assignee as string) ?? ""}
            onChange={(e) => update({ config: { assignee: e.target.value } })}
            placeholder="manager@company.com"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          />
        </>
      )}

      {node.type === "notify" && (
        <>
          <label className="block text-zinc-500">Canal</label>
          <select
            value={(config.channel as string) ?? "log"}
            onChange={(e) => update({ config: { channel: e.target.value } })}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          >
            <option value="log">Log (consola)</option>
            <option value="email">Email</option>
            <option value="slack">Slack</option>
            <option value="webhook">Webhook</option>
          </select>
          <label className="block text-zinc-500">Mensaje</label>
          <textarea
            value={(config.message as string) ?? ""}
            onChange={(e) => update({ config: { message: e.target.value } })}
            rows={2}
            placeholder="Lead nuevo: {{nombre}}"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-violet-500/60"
          />
        </>
      )}
    </div>
  );
}

function SubflowPicker({
  currentFlowId,
  onChange,
}: {
  currentFlowId: string;
  onChange: (id: string) => void;
}) {
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    fetch("/api/flows")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setFlows(Array.isArray(d) ? d : []))
      .catch(() => setFlows([]));
  }, []);
  return (
    <>
      <label className="block text-zinc-500">Flujo a invocar</label>
      <select
        value={currentFlowId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
      >
        <option value="">— elegir —</option>
        {flows.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </>
  );
}

function VariablesPanel({
  variables,
  onChange,
  onClose,
}: {
  variables: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState<{ key: string; value: string }[]>(() =>
    Object.entries(variables).map(([k, v]) => ({
      key: k,
      value: typeof v === "string" ? v : JSON.stringify(v),
    }))
  );

  function commit(rows: { key: string; value: string }[]) {
    const out: Record<string, unknown> = {};
    for (const { key, value } of rows) {
      if (!key.trim()) continue;
      // Try parsing as JSON for numbers/bools/objects, fallback to raw string
      let parsed: unknown = value;
      try {
        parsed = JSON.parse(value);
      } catch {}
      out[key.trim()] = parsed;
    }
    onChange(out);
  }

  return (
    <div className="absolute left-48 top-0 z-30 flex h-full w-[340px] flex-col border-r border-white/[0.06] bg-zinc-950">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-zinc-200">
          <Variable className="h-4 w-4" /> Variables
        </span>
        <button onClick={onClose} type="button" className="text-zinc-500 hover:text-zinc-200">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-xs">
        <p className="mb-1 text-[11px] text-zinc-500">
          Variables iniciales del flujo (también se usan como defaults para los runs).
        </p>
        {pending.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={row.key}
              onChange={(e) => {
                const next = pending.slice();
                next[i] = { ...row, key: e.target.value };
                setPending(next);
              }}
              onBlur={() => commit(pending)}
              placeholder="nombre"
              className="w-1/3 rounded-md border border-white/[0.08] bg-zinc-800/40 px-2 py-1 font-mono text-zinc-100 outline-none focus:border-violet-500/60"
            />
            <input
              value={row.value}
              onChange={(e) => {
                const next = pending.slice();
                next[i] = { ...row, value: e.target.value };
                setPending(next);
              }}
              onBlur={() => commit(pending)}
              placeholder='"valor" o 42 o {…}'
              className="flex-1 rounded-md border border-white/[0.08] bg-zinc-800/40 px-2 py-1 font-mono text-zinc-100 outline-none focus:border-violet-500/60"
            />
            <button
              type="button"
              onClick={() => {
                const next = pending.filter((_, j) => j !== i);
                setPending(next);
                commit(next);
              }}
              className="text-zinc-500 hover:text-red-400"
              aria-label="Eliminar"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setPending([...pending, { key: "", value: "" }])}
          className="mt-1 w-full rounded-md border border-dashed border-white/10 py-1.5 text-[11px] text-zinc-500 hover:border-violet-500/40 hover:text-violet-300"
        >
          + agregar variable
        </button>
      </div>
    </div>
  );
}
