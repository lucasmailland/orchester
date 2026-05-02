"use client";

import { useCallback, useEffect, useState } from "react";
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
import { Save, Play, Loader2, History, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const nodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  condition: ConditionNode,
  http: HttpNode,
  transform: AgentNode,
  delay: AgentNode,
  notify: AgentNode,
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
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

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

  async function save() {
    setSaving(true);
    setFeedback(null);
    const payload = {
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
    };
    const r = await fetch(`/api/flows/${flow.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (r.ok) toast.success("Flujo guardado");
    else toast.error("No se pudo guardar el flujo");
  }

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
              onClick={save}
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
    http: "HTTP",
    transform: "Transformar",
    delay: "Esperar",
    notify: "Notificar",
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
  const types = [
    { id: "agent", label: "Agente", emoji: "🤖" },
    { id: "condition", label: "Condición", emoji: "🔀" },
    { id: "http", label: "HTTP", emoji: "🌐" },
    { id: "transform", label: "Transformar", emoji: "🔧" },
    { id: "delay", label: "Esperar", emoji: "⏱" },
    { id: "notify", label: "Notificar", emoji: "📨" },
  ];
  return (
    <div className="w-44 border-r border-white/[0.06] bg-zinc-950 p-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        Nodos
      </div>
      {types.map((t) => (
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
            {["GET", "POST", "PUT", "DELETE"].map((m) => (
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
          <label className="block text-zinc-500">Output var</label>
          <input
            value={(config.outputVar as string) ?? ""}
            onChange={(e) => update({ config: { outputVar: e.target.value } })}
            placeholder="httpResult"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
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
    </div>
  );
}
