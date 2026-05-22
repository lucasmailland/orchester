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
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createId } from "@paralleldrive/cuid2";
import { RegistryNode } from "./nodes/RegistryNode";
import { ConditionNode, TryCatchNode, LoopNode, SwitchNode } from "./nodes/BranchNode";
import { FlowRunsPanel } from "./FlowRunsPanel";
import { InspectorForm } from "./inspector/InspectorForm";
import { NodePalette } from "./NodePalette";
import { CopilotPanel } from "./CopilotPanel";
import { getNodeDef, type Locale } from "@/lib/flows/node-registry";
import { autoLayout } from "@/lib/flows/layout";
import { validateFlow, type ValidationIssue } from "@/lib/flows/validate";
import { buildGraphFromSpec } from "@/lib/flows/copilot-tools";
import { FLOW_TEMPLATES, type FlowTemplate } from "@/lib/flows/templates";
import {
  Save, Play, Loader2, History, ArrowLeft, Variable, X, Sparkles,
  Undo2, Redo2, LayoutGrid, ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";

const LOCALE: Locale = "es";

const nodeTypes = {
  trigger: RegistryNode,
  agent: RegistryNode,
  condition: ConditionNode,
  switch: SwitchNode,
  http: RegistryNode,
  transform: RegistryNode,
  delay: RegistryNode,
  notify: RegistryNode,
  code: RegistryNode,
  loop_for_each: LoopNode,
  parallel: RegistryNode,
  try_catch: TryCatchNode,
  subflow: RegistryNode,
  wait_human: RegistryNode,
  integration: RegistryNode,
  kb_search: RegistryNode,
  spreadsheet: RegistryNode,
  note: RegistryNode,
  generate_image: RegistryNode,
  embed_text: RegistryNode,
  llm_prompt: RegistryNode,
  generate_video: RegistryNode,
  text_to_speech: RegistryNode,
  transcribe: RegistryNode,
  rerank: RegistryNode,
  generate_avatar: RegistryNode,
  generate_music: RegistryNode,
  ocr_extract: RegistryNode,
};

/** Deriva el id del registry a partir del nodo guardado (que sólo tiene engine type). */
function deriveNodeId(n: { type: string; config?: Record<string, unknown> }): string {
  if (n.type === "trigger") {
    const kind = (n.config?.triggerKind as string) ?? "manual";
    return `trigger_${kind}`;
  }
  return n.type;
}

export interface FlowDTO {
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
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [runStatus, setRunStatus] = useState<Record<string, "running" | "succeeded" | "failed">>({});
  const [runLog, setRunLog] = useState<Array<{ nodeId: string; status: "running" | "succeeded" | "failed"; error?: string }>>([]);
  const [runInspectorOpen, setRunInspectorOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const historyRef = useRef<{ past: Array<{ nodes: Node[]; edges: Edge[] }>; future: Array<{ nodes: Node[]; edges: Edge[] }> }>({ past: [], future: [] });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const clipboardRef = useRef<Node | null>(null);

  /** Crea una copia del nodo dado, desplazada y seleccionada. */
  function duplicateFrom(source: Node | null) {
    if (!source) return;
    pushHistory();
    const id = createId();
    const copy: Node = {
      id,
      type: source.type,
      position: { x: source.position.x + 40, y: source.position.y + 40 },
      data: JSON.parse(JSON.stringify(source.data ?? {})),
    };
    setNodes((nds) => [...nds, copy]);
    setSelected(copy);
  }

  function pushHistory() {
    const h = historyRef.current;
    h.past.push({ nodes, edges });
    if (h.past.length > 50) h.past.shift();
    h.future = [];
    setCanUndo(true);
    setCanRedo(false);
  }
  function undo() {
    const h = historyRef.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push({ nodes, edges });
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setSelected(null);
    setCanUndo(h.past.length > 0);
    setCanRedo(true);
  }
  function redo() {
    const h = historyRef.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push({ nodes, edges });
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelected(null);
    setCanUndo(true);
    setCanRedo(h.future.length > 0);
  }
  function runAutoLayout() {
    pushHistory();
    setNodes((nds) => layoutGraph(nds, edges));
  }
  function useTemplate(tpl: FlowTemplate) {
    pushHistory();
    const built = buildGraphFromSpec(tpl.spec, () => createId());
    const builtEdges = built.edges as Edge[];
    setNodes(layoutGraph(built.nodes as Node[], builtEdges));
    setEdges(builtEdges);
    setSelected(null);
  }
  const [feedback, setFeedback] = useState<string | null>(null);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runInputDraft, setRunInputDraft] = useState("{\n  \n}");
  const [runInputError, setRunInputError] = useState<string | null>(null);
  const [runFields, setRunFields] = useState<Record<string, string>>({});
  const [runJsonMode, setRunJsonMode] = useState(false);
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

  function addNode(nodeId: string, at?: { x: number; y: number }) {
    const def = getNodeDef(nodeId);
    if (!def) return;
    pushHistory();
    const id = createId();
    const config = { ...(def.defaults ?? {}), ...(def.fixedConfig ?? {}) };
    // Posición: donde se soltó (drag&drop), o al lado del paso seleccionado para
    // poder encadenar, o un lugar libre por defecto.
    const position =
      at ??
      (selected
        ? { x: selected.position.x + 260, y: selected.position.y }
        : { x: 350 + Math.random() * 80, y: 180 + Math.random() * 80 });
    const newNode: Node = {
      id,
      type: def.engine,
      position,
      data: { label: def.title[LOCALE], config, nodeId: def.id },
    };
    setNodes((nds) => [...nds, newNode]);
    // Auto-conectar desde el paso seleccionado (salvo que sea un disparador el nuevo).
    if (selected && !at && def.engine !== "trigger") {
      const handle = defaultSourceHandle(selected);
      const edge: Edge = { id: createId(), source: selected.id, target: id };
      if (handle) edge.sourceHandle = handle;
      setEdges((eds) => [...eds, edge]);
    }
    setSelected(newNode);
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

  // Atajos de teclado: Cmd/Ctrl+Z deshacer, Cmd/Ctrl+Shift+Z rehacer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && key === "c" && selected) {
        e.preventDefault();
        clipboardRef.current = selected;
      } else if (mod && key === "v" && clipboardRef.current) {
        e.preventDefault();
        duplicateFrom(clipboardRef.current);
      } else if (mod && key === "d" && selected) {
        e.preventDefault();
        duplicateFrom(selected);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, selected]);

  // Al abrir un flujo guardado, si los pasos se superponen, los ordenamos una vez
  // para que se vea prolijo (no tocamos flujos ya bien acomodados a mano).
  const didTidyRef = useRef(false);
  useEffect(() => {
    if (didTidyRef.current) return;
    didTidyRef.current = true;
    if (nodes.length > 1 && hasOverlap(nodes)) {
      setNodes((nds) => layoutGraph(nds, edges));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openRunModal() {
    // Pre-llená un formulario con las variables del flujo (más amigable que JSON).
    const seed: Record<string, string> = {};
    for (const [k, v] of Object.entries(variables)) {
      seed[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    setRunFields(seed);
    setRunInputDraft(JSON.stringify(Object.keys(variables).length > 0 ? variables : {}, null, 2));
    setRunInputError(null);
    setRunJsonMode(false);
    setRunModalOpen(true);
  }

  /** Convierte el formulario en un objeto, parseando números/booleanos/JSON. */
  function buildInputFromFields(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(runFields)) {
      if (!k.trim()) continue;
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* dejar como string */
      }
      out[k] = parsed;
    }
    return out;
  }

  async function runWithInput(input: Record<string, unknown>) {
    setRunModalOpen(false);
    setRunning(true);
    setFeedback(null);
    setRunStatus({});
    setRunLog([]);
    setRunInspectorOpen(true);
    let finalStatus: "succeeded" | "failed" | null = null;
    let finalError: string | undefined;
    try {
      const r = await fetch(`/api/flows/${flow.id}/run-stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });
      if (!r.ok || !r.body) throw new Error(`No se pudo iniciar (${r.status})`);
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = block.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let ev: { type: string; nodeId?: string; status?: "succeeded" | "failed"; error?: string };
          try {
            ev = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (ev.type === "step_start" && ev.nodeId) {
            const nid = ev.nodeId;
            setRunStatus((s) => ({ ...s, [nid]: "running" }));
            setRunLog((l) => [...l, { nodeId: nid, status: "running" }]);
          } else if (ev.type === "step_finish" && ev.nodeId && ev.status) {
            const nid = ev.nodeId;
            const st = ev.status;
            setRunStatus((s) => ({ ...s, [nid]: st }));
            setRunLog((l) => {
              const copy = [...l];
              for (let i = copy.length - 1; i >= 0; i--) {
                if (copy[i]!.nodeId === nid && copy[i]!.status === "running") {
                  copy[i] = { nodeId: nid, status: st, ...(ev.error ? { error: ev.error } : {}) };
                  return copy;
                }
              }
              return [...copy, { nodeId: nid, status: st, ...(ev.error ? { error: ev.error } : {}) }];
            });
          } else if (ev.type === "run_finish" && ev.status) {
            finalStatus = ev.status;
            finalError = ev.error;
          }
        }
      }
    } catch (e) {
      finalStatus = "failed";
      finalError = e instanceof Error ? e.message : String(e);
    }
    setRunning(false);
    if (finalStatus === "succeeded") toast.success("Ejecución completada");
    else toast.error(`La ejecución falló${finalError ? `: ${finalError}` : ""}`);
  }

  function submitRunModal() {
    if (!runJsonMode) {
      void runWithInput(buildInputFromFields());
      return;
    }
    try {
      const parsed = runInputDraft.trim() ? JSON.parse(runInputDraft) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setRunInputError("Los datos tienen que ser un objeto ({…}).");
        return;
      }
      void runWithInput(parsed as Record<string, unknown>);
    } catch (e) {
      setRunInputError(e instanceof Error ? e.message : "El JSON tiene un error.");
    }
  }

  // Mapa de avisos de validación por nodo (para el badge ⚠️ sobre cada paso).
  const issuesByNode: Record<string, string[]> = {};
  for (const iss of validateFlow(
    nodes.map((n) => ({ id: n.id, type: n.type, data: n.data as { nodeId?: string; label?: string; config?: Record<string, unknown> } })),
    edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}) })),
    LOCALE
  )) {
    if (iss.nodeId) (issuesByNode[iss.nodeId] ??= []).push(iss.message);
  }

  const displayNodes: Node[] = nodes.map((n) => {
    const st = runStatus[n.id];
    const badge = issuesByNode[n.id]?.join("\n") ?? null;
    const subtitle = cardSubtitle(n);
    const cls = st === "succeeded" ? "flow-node-ok" : st === "failed" ? "flow-node-fail" : st === "running" ? "flow-node-running" : undefined;
    return { ...n, ...(cls ? { className: cls } : {}), data: { ...n.data, badge, subtitle } };
  });

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
              onClick={undo}
              disabled={!canUndo}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-body hover:bg-hover disabled:opacity-30"
              title="Deshacer (Cmd/Ctrl+Z)"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-body hover:bg-hover disabled:opacity-30"
              title="Rehacer (Cmd/Ctrl+Shift+Z)"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={runAutoLayout}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-body hover:bg-hover"
              title="Ordenar los pasos automáticamente"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setValidationOpen((o) => !o)}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-body hover:bg-hover"
              title="Revisar el flujo"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setCopilotOpen((o) => !o)}
              className={
                copilotOpen
                  ? "flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1.5 text-xs font-medium text-violet-600 dark:text-violet-300"
                  : "flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-body hover:bg-hover"
              }
              title="Copiloto: armá el flujo hablando"
            >
              <Sparkles className="h-3.5 w-3.5" /> Copiloto
            </button>
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
          <div
            className="relative flex-1"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const nodeId = e.dataTransfer.getData("application/flow-node");
              if (!nodeId) return;
              const pos = rfRef.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY });
              addNode(nodeId, pos ?? { x: e.clientX, y: e.clientY });
            }}
          >
            <ReactFlow
              nodes={displayNodes}
              edges={edges}
              onInit={(inst) => {
                rfRef.current = inst;
              }}
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
            {nodes.length === 0 && <EmptyCanvasGuide onAdd={addNode} onUseTemplate={useTemplate} />}
          </div>
          <div className="w-72 shrink-0 overflow-y-auto border-l border-line bg-surface">
            <InspectorForm
              node={selected}
              locale={LOCALE}
              availableData={collectAvailableData(nodes, variables)}
              onChange={(updated) => {
                setNodes((nds) => nds.map((n) => (n.id === updated.id ? updated : n)));
                setSelected(updated);
              }}
              onDelete={(id) => {
                pushHistory();
                setNodes((nds) => nds.filter((n) => n.id !== id));
                setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
                setSelected(null);
              }}
            />
          </div>
          <CopilotPanel
            flowId={flow.id}
            open={copilotOpen}
            onClose={() => setCopilotOpen(false)}
            describeFlow={() => describeGraph(nodes, edges)}
            currentGraph={() => graphSpec(nodes, edges)}
            onApplyGraph={(newNodes, newEdges, mode) => {
              pushHistory();
              if (mode === "merge") {
                const combinedNodes = [...nodes, ...newNodes];
                const combinedEdges = [...edges, ...newEdges];
                setNodes(layoutGraph(combinedNodes, combinedEdges));
                setEdges(combinedEdges);
              } else {
                setNodes(layoutGraph(newNodes, newEdges));
                setEdges(newEdges);
              }
              setSelected(null);
            }}
          />
          {runInspectorOpen && (
            <RunInspector
              log={runLog}
              running={running}
              nodes={nodes}
              onClose={() => setRunInspectorOpen(false)}
            />
          )}
          {validationOpen && (
            <ValidationPanel
              nodes={nodes}
              edges={edges}
              onClose={() => setValidationOpen(false)}
              onSelect={(id) => {
                const n = nodes.find((x) => x.id === id);
                if (n) setSelected(n);
              }}
            />
          )}
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
                    {Object.keys(runFields).length > 0
                      ? "Completá los datos con los que querés probar el flujo."
                      : "Este flujo no necesita datos para arrancar."}
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

              {!runJsonMode ? (
                <div className="flex flex-col gap-3">
                  {Object.keys(runFields).length === 0 && (
                    <p className="rounded-lg border border-line bg-card p-3 text-xs text-muted">
                      Hacé clic en “Ejecutar” para correrlo. Si querés, agregá variables al flujo
                      desde el botón de variables.
                    </p>
                  )}
                  {Object.entries(runFields).map(([key, val]) => (
                    <div key={key}>
                      <label className="mb-1 block text-[11px] font-medium text-body">{key}</label>
                      <input
                        value={val}
                        onChange={(e) => setRunFields((f) => ({ ...f, [key]: e.target.value }))}
                        className="w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-strong outline-none focus:border-violet-500/60"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <label htmlFor="run-input-json" className="mb-1 block text-[10px] uppercase tracking-wider text-muted">
                    Datos (JSON)
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
                </>
              )}
              {runInputError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">⚠ {runInputError}</p>
              )}
              <button
                type="button"
                onClick={() => {
                  if (!runJsonMode) {
                    // pasar a JSON con lo que haya en el form
                    setRunInputDraft(JSON.stringify(buildInputFromFields(), null, 2));
                  }
                  setRunInputError(null);
                  setRunJsonMode((m) => !m);
                }}
                className="mt-2 text-[11px] text-muted hover:text-body"
              >
                {runJsonMode ? "← Volver al formulario" : "Editar como JSON (avanzado)"}
              </button>
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

/** Guía amigable cuando el lienzo está vacío: plantillas + cómo arrancar de cero. */
function EmptyCanvasGuide({
  onAdd,
  onUseTemplate,
}: {
  onAdd: (nodeId: string) => void;
  onUseTemplate: (tpl: FlowTemplate) => void;
}) {
  const starters: Array<{ id: string; label: string; emoji: string }> = [
    { id: "trigger_manual", label: "Cuando lo ejecuto yo", emoji: "▶️" },
    { id: "trigger_message", label: "Cuando llega un mensaje", emoji: "💬" },
    { id: "trigger_schedule", label: "En un horario", emoji: "🕒" },
    { id: "trigger_webhook", label: "Con un webhook", emoji: "🔗" },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-y-auto p-4">
      <div className="pointer-events-auto my-auto w-full max-w-xl rounded-2xl border border-line bg-surface/95 p-6 shadow-xl backdrop-blur">
        <div className="text-center">
          <div className="text-2xl">🚀</div>
          <h3 className="mt-2 text-sm font-semibold text-strong">Armemos tu primer flujo</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Un flujo es una secuencia de pasos automáticos. Empezá con una plantilla
            lista, desde cero, o pedile al copiloto que lo arme por vos.
          </p>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">Plantillas para empezar</p>
          <div className="grid grid-cols-2 gap-2">
            {FLOW_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onUseTemplate(t)}
                className="flex flex-col gap-1 rounded-lg border border-line bg-card p-3 text-left transition-colors hover:bg-elevated hover:border-violet-500/40"
              >
                <span className="text-base">{t.emoji}</span>
                <span className="text-xs font-medium text-body">{t.name}</span>
                <span className="text-[10px] leading-tight text-faint">{t.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">…o empezá de cero</p>
          <div className="flex flex-wrap gap-1.5">
            {starters.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onAdd(s.id)}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs text-body transition-colors hover:bg-elevated"
              >
                <span>{s.emoji}</span> {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Panel de revisión: lista los problemas del flujo en lenguaje simple. */
function ValidationPanel({
  nodes,
  edges,
  onClose,
  onSelect,
}: {
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const issues: ValidationIssue[] = validateFlow(
    nodes.map((n) => ({ id: n.id, type: n.type, data: n.data as { nodeId?: string; label?: string; config?: Record<string, unknown> } })),
    edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}) })),
    LOCALE
  );
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium text-strong">
          <ShieldCheck className="h-4 w-4" /> Revisión del flujo
        </span>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted hover:text-body">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-xs">
        {issues.length === 0 && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-emerald-600 dark:text-emerald-400">
            ✅ Todo en orden. El flujo está listo para ejecutarse.
          </div>
        )}
        {errors.map((iss, i) => (
          <button
            key={`e${i}`}
            type="button"
            onClick={() => iss.nodeId && onSelect(iss.nodeId)}
            className="block w-full rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-left text-red-600 dark:text-red-400 hover:bg-red-500/10"
          >
            ⛔ {iss.message}
          </button>
        ))}
        {warnings.map((iss, i) => (
          <button
            key={`w${i}`}
            type="button"
            onClick={() => iss.nodeId && onSelect(iss.nodeId)}
            className="block w-full rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-left text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
          >
            ⚠️ {iss.message}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Panel que muestra, paso a paso y en vivo, qué pasó en la última ejecución. */
function RunInspector({
  log,
  running,
  nodes,
  onClose,
}: {
  log: Array<{ nodeId: string; status: "running" | "succeeded" | "failed"; error?: string }>;
  running: boolean;
  nodes: Node[];
  onClose: () => void;
}) {
  const labelOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    const d = n?.data as { label?: string; nodeId?: string } | undefined;
    if (d?.label) return d.label;
    const def = getNodeDef(String(d?.nodeId ?? n?.type ?? ""));
    return def ? def.title[LOCALE] : id;
  };
  const icon = (s: string) => (s === "succeeded" ? "✅" : s === "failed" ? "❌" : "⏳");
  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-sm font-medium text-strong">
          {running ? "Ejecutando…" : "Resultado de la ejecución"}
        </span>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted hover:text-body">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-xs">
        {log.length === 0 && (
          <p className="text-muted">Todavía no se ejecutó ningún paso.</p>
        )}
        {log.map((s, i) => (
          <div key={i} className="rounded-lg border border-line bg-card p-2.5">
            <div className="flex items-center gap-2 text-body">
              <span>{icon(s.status)}</span>
              <span className="font-medium">{labelOf(s.nodeId)}</span>
            </div>
            {s.error && (
              <p className="mt-1 rounded-md bg-red-500/5 px-2 py-1 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
                {s.error}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Resumen de una línea para la tarjeta del nodo, derivado de su configuración actual. */
function cardSubtitle(n: Node): string {
  const d = n.data as { nodeId?: string; config?: Record<string, unknown> } | undefined;
  const cfg = d?.config ?? {};
  const def = getNodeDef(String(d?.nodeId ?? n.type ?? ""));
  const eng = def?.engine ?? n.type ?? "";
  const s = (v: unknown, max = 30) => {
    const str = String(v ?? "").trim();
    return str.length > max ? `${str.slice(0, max)}…` : str;
  };
  switch (eng) {
    case "http":
      return cfg.url ? s(cfg.url, 34) : "";
    case "integration": {
      const action = String(cfg.integrationId ?? "").split("::")[1];
      return action ? `acción: ${s(action)}` : "";
    }
    case "kb_search":
      return cfg.query ? `busca: ${s(cfg.query)}` : "";
    case "condition":
      return cfg.left ? `${s(cfg.left, 14)} ${s(cfg.op, 8)} ${s(cfg.right, 14)}` : "";
    case "delay":
      return cfg.duration ? `espera ${s(cfg.duration, 12)}` : "";
    case "notify":
      return cfg.to ? `a ${s(cfg.to)}` : "";
    case "spreadsheet":
      return cfg.formula ? s(cfg.formula, 30) : "";
    case "subflow":
      return cfg.flowId ? "flujo elegido" : "";
    default:
      return "";
  }
}

/** Datos disponibles para usar en los campos (variables del flujo + salidas de pasos). */
function collectAvailableData(nodes: Node[], variables: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const k of Object.keys(variables)) out.add(k);
  // Salida por defecto de cada tipo de paso.
  const outputByEngine: Record<string, string> = {
    trigger: "message",
    agent: "agentResult",
    http: "httpResult",
    kb_search: "knowledge",
    integration: "appResult",
    spreadsheet: "result",
    transform: "result",
    loop_for_each: "loopResults",
  };
  let hasLoop = false;
  for (const n of nodes) {
    const d = n.data as { nodeId?: string; config?: Record<string, unknown> } | undefined;
    const def = getNodeDef(String(d?.nodeId ?? n.type ?? ""));
    const eng = def?.engine ?? n.type ?? "";
    const custom = d?.config?.outputVar;
    if (typeof custom === "string" && custom.trim()) out.add(custom.trim());
    else if (outputByEngine[eng]) out.add(outputByEngine[eng]!);
    if (eng === "loop_for_each") hasLoop = true;
  }
  if (hasLoop) out.add("item");
  return Array.from(out);
}

/** Tamaño estimado de un nodo para que el auto-layout no los superponga. */
function nodeSize(n: Node): { width: number; height: number } {
  const d = n.data as { nodeId?: string; config?: Record<string, unknown> } | undefined;
  const def = getNodeDef(String(d?.nodeId ?? n.type ?? ""));
  const eng = def?.engine ?? n.type;
  if (eng === "switch") {
    const cases = Array.isArray(d?.config?.cases) ? (d!.config!.cases as unknown[]).length : 0;
    return { width: 220, height: Math.max(72, (cases + 1) * 30 + 28) };
  }
  if (eng === "condition" || eng === "try_catch" || eng === "loop_for_each") {
    return { width: 220, height: 100 };
  }
  return { width: 210, height: 64 };
}

/** Reordena un grafo (nodos + edges) con el motor de layout, listo para setNodes. */
function layoutGraph(ns: Node[], es: Edge[]): Node[] {
  return autoLayout(ns, es.map((e) => ({ source: e.source, target: e.target })), nodeSize);
}

/** ¿Hay pasos que se superponen en el lienzo? (para auto-ordenar al abrir). */
function hasOverlap(nodes: Node[]): boolean {
  const boxes = nodes.map((n) => {
    const s = nodeSize(n);
    return { x1: n.position.x, y1: n.position.y, x2: n.position.x + s.width, y2: n.position.y + s.height };
  });
  const pad = 8;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const apart = a.x2 + pad <= b.x1 || b.x2 + pad <= a.x1 || a.y2 + pad <= b.y1 || b.y2 + pad <= a.y1;
      if (!apart) return true;
    }
  }
  return false;
}

/** Handle de salida por defecto al auto-conectar desde un paso con varios caminos. */
function defaultSourceHandle(n: Node): string | undefined {
  const d = n.data as { nodeId?: string } | undefined;
  const def = getNodeDef(String(d?.nodeId ?? n.type ?? ""));
  const eng = def?.engine ?? n.type;
  if (eng === "condition") return "true";
  if (eng === "try_catch") return "try";
  if (eng === "loop_for_each") return "body";
  if (eng === "switch") return "default";
  return undefined;
}

/** Spec estructurada del flujo para que el copiloto pueda editarlo (no de cero). */
function graphSpec(nodes: Node[], edges: Edge[]): { nodes: unknown[]; edges: unknown[] } {
  return {
    nodes: nodes.map((n) => {
      const d = n.data as { nodeId?: string; label?: string; config?: Record<string, unknown> } | undefined;
      return {
        id: n.id,
        nodeId: d?.nodeId ?? n.type,
        label: d?.label ?? "",
        config: d?.config ?? {},
      };
    }),
    edges: edges.map((e) => ({
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(typeof e.label === "string" ? { label: e.label } : {}),
    })),
  };
}

/** Resume el grafo en texto plano para que el copiloto pueda explicarlo/revisarlo. */
function describeGraph(nodes: Node[], edges: Edge[]): string {
  if (nodes.length === 0) return "";
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const lines = nodes.map((n) => {
    const d = n.data as { label?: string; nodeId?: string; config?: Record<string, unknown> };
    const def = getNodeDef(String(d.nodeId ?? n.type ?? ""));
    const kind = def ? def.title["es"] : String(n.type);
    const cfg = d.config && Object.keys(d.config).length ? ` config=${JSON.stringify(d.config)}` : "";
    return `• ${d.label ?? kind} [${kind}]${cfg}`;
  });
  const conns = edges.map((e) => {
    const s = byId.get(e.source)?.data as { label?: string } | undefined;
    const t = byId.get(e.target)?.data as { label?: string } | undefined;
    const handle = e.sourceHandle ? ` (${e.sourceHandle})` : "";
    return `• ${s?.label ?? e.source}${handle} → ${t?.label ?? e.target}`;
  });
  return `Pasos:\n${lines.join("\n")}\n\nConexiones:\n${conns.join("\n") || "(ninguna)"}`;
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
