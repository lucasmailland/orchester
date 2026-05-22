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
import { InspectorForm } from "./inspector/InspectorForm";
import { NodePalette } from "./NodePalette";
import { getNodeDef, type Locale } from "@/lib/flows/node-registry";
import { Save, Play, Loader2, History, ArrowLeft, Variable, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";

const LOCALE: Locale = "es";

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
  // nuevos del registry (reutilizan visuales existentes por ahora)
  integration: HttpNode,
  kb_search: AgentNode,
  spreadsheet: AgentNode,
  note: AgentNode,
};

/** Deriva el id del registry a partir del nodo guardado (que sólo tiene engine type). */
function deriveNodeId(n: { type: string; config?: Record<string, unknown> }): string {
  if (n.type === "trigger") {
    const kind = (n.config?.triggerKind as string) ?? "manual";
    return `trigger_${kind}`;
  }
  return n.type;
}

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
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const [nodes, setNodes] = useState<Node[]>(
    flow.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { label: n.label, subtitle: subtitleFor(n), config: n.config, nodeId: deriveNodeId(n) },
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
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runInputDraft, setRunInputDraft] = useState("{\n  \n}");
  const [runInputError, setRunInputError] = useState<string | null>(null);
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

  function addNode(nodeId: string) {
    const def = getNodeDef(nodeId);
    if (!def) return;
    const id = createId();
    const config = { ...(def.defaults ?? {}), ...(def.fixedConfig ?? {}) };
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: def.engine,
        position: { x: 350 + Math.random() * 100, y: 200 + Math.random() * 100 },
        data: { label: def.title[LOCALE], config, nodeId: def.id },
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

  function openRunModal() {
    // Pre-llená el input con las variables actuales del flow para que el operador
    // arranque desde algo significativo en lugar de un objeto vacío.
    const seed = Object.keys(variables).length > 0 ? variables : {};
    setRunInputDraft(JSON.stringify(seed, null, 2));
    setRunInputError(null);
    setRunModalOpen(true);
  }

  async function runWithInput(input: Record<string, unknown>) {
    setRunModalOpen(false);
    setRunning(true);
    setFeedback(null);
    const r = await fetch(`/api/flows/${flow.id}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    });
    setRunning(false);
    const j = await r.json();
    if (j.status === "succeeded") toast.success("Ejecución completada");
    else toast.error(`Ejecución ${j.status}${j.error ? `: ${j.error}` : ""}`);
    if (runsOpen) setRunsOpen(false);
    setTimeout(() => setRunsOpen(true), 300);
  }

  function submitRunModal() {
    try {
      const parsed = runInputDraft.trim() ? JSON.parse(runInputDraft) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setRunInputError("El input debe ser un objeto JSON ({…})");
        return;
      }
      void runWithInput(parsed as Record<string, unknown>);
    } catch (e) {
      setRunInputError(e instanceof Error ? e.message : "JSON inválido");
    }
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-screen flex-col bg-app text-strong">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="text-muted hover:text-strong"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">{flow.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {feedback && <span className="text-[11px] text-muted">{feedback}</span>}
            {autoSaveStatus !== "idle" && (
              <span
                className={
                  autoSaveStatus === "saving"
                    ? "text-[11px] text-muted"
                    : autoSaveStatus === "error"
                    ? "text-[11px] text-red-600 dark:text-red-400"
                    : "text-[11px] text-emerald-600 dark:text-emerald-400"
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
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-body hover:bg-hover"
              title="Variables del flujo"
            >
              <Variable className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setRunsOpen((o) => !o)}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-body hover:bg-hover"
              title="Historial de ejecuciones"
            >
              <History className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => save()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-hover disabled:opacity-40"
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
              onClick={openRunModal}
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
          <NodePalette onAdd={addNode} locale={LOCALE} />
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
              colorMode={isLight ? "light" : "dark"}
              proOptions={{ hideAttribution: true }}
            >
              <Background color={isLight ? "#d4d4d8" : "#27272a"} gap={20} />
              <Controls className="!border-line !bg-surface" />
              <MiniMap pannable zoomable className="!border-line !bg-surface" />
            </ReactFlow>
          </div>
          <div className="w-72 shrink-0 overflow-y-auto border-l border-line bg-surface">
            <InspectorForm
              node={selected}
              locale={LOCALE}
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
          </div>
          <FlowRunsPanel
            flowId={flow.id}
            open={runsOpen}
            onClose={() => setRunsOpen(false)}
          />
        </div>
        {runModalOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="run-modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-app/60 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setRunModalOpen(false);
            }}
          >
            <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-2xl">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h2 id="run-modal-title" className="text-sm font-semibold text-strong">
                    Ejecutar flujo
                  </h2>
                  <p className="mt-0.5 text-xs text-muted">
                    Pegá el JSON con el input que recibirá el nodo trigger.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar"
                  onClick={() => setRunModalOpen(false)}
                  className="rounded-lg p-1 text-muted hover:bg-white/[0.05] hover:text-body"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <label htmlFor="run-input-json" className="mb-1 block text-[10px] uppercase tracking-wider text-muted">
                Input
              </label>
              <textarea
                id="run-input-json"
                name="run-input"
                value={runInputDraft}
                onChange={(e) => {
                  setRunInputDraft(e.target.value);
                  if (runInputError) setRunInputError(null);
                }}
                rows={10}
                spellCheck={false}
                className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-strong outline-none focus:border-violet-500/60"
              />
              {runInputError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">⚠ {runInputError}</p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRunModalOpen(false)}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-body hover:bg-white/[0.05]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={submitRunModal}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400"
                >
                  <Play className="h-3.5 w-3.5" /> Ejecutar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ReactFlowProvider>
  );
}

function subtitleFor(n: { type: string; config: Record<string, unknown> }): string {
  if (n.type === "agent" && n.config.agentId)
    return `agentId: ${(n.config.agentId as string).slice(0, 8)}`;
  if (n.type === "http" && n.config.url) return String(n.config.url).slice(0, 32);
  return "";
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
    <div className="absolute left-48 top-0 z-30 flex h-full w-[340px] flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-body">
          <Variable className="h-4 w-4" /> Variables
        </span>
        <button onClick={onClose} type="button" className="text-muted hover:text-body">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-xs">
        <p className="mb-1 text-[11px] text-muted">
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
              className="w-1/3 rounded-md border border-line bg-elevated px-2 py-1 font-mono text-strong outline-none focus:border-violet-500/60"
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
              className="flex-1 rounded-md border border-line bg-elevated px-2 py-1 font-mono text-strong outline-none focus:border-violet-500/60"
            />
            <button
              type="button"
              onClick={() => {
                const next = pending.filter((_, j) => j !== i);
                setPending(next);
                commit(next);
              }}
              className="text-muted hover:text-red-600 dark:hover:text-red-400"
              aria-label="Eliminar"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setPending([...pending, { key: "", value: "" }])}
          className="mt-1 w-full rounded-md border border-dashed border-line py-1.5 text-[11px] text-muted hover:border-violet-500/40 hover:text-violet-700 dark:hover:text-violet-300"
        >
          + agregar variable
        </button>
      </div>
    </div>
  );
}
