# Flow Builder Revamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el Flow Builder de una herramienta "para técnicos" en una herramienta híbrida, mega-potente y entendible: copys claros, una biblioteca grande de nodos (reusando connectors + triggers reales + knowledge base + nodo Excel), un inspector auto-generado con instrucciones, y un copiloto de IA que arma/edita el flujo conversando.

**Architecture:** Un **registro declarativo de nodos** (`node-registry.ts`) es la fuente de verdad: cada nodo declara su categoría, copys (humano + técnico), schema de campos (para auto-generar el inspector), y cómo se ejecuta en el motor. El palette, el inspector y el copiloto se derivan TODOS de ese registro (DRY). Los nodos de integración **reusan el framework de Integraciones** existente (`lib/integrations`), así cada connector aparece como nodo sin código nuevo. El copiloto usa `llmCall` con function-calling cuyas tools mutan el grafo `{nodes, edges}`.

**Tech Stack:** Next.js 15, @xyflow/react, el flow-engine existente (`lib/flow-engine.ts`), connector framework (`lib/integrations`), `llmCall` (function calling), Zod para schemas.

**Restricción legal:** NO copiar código de n8n (Sustainable Use License, prohíbe uso comercial competidor). Inspiración de taxonomía OK. Fuentes permisivas a mirar: Node-RED (Apache-2.0), Activepieces/Pipedream (MIT). Todos los nodos se diseñan propios.

**🗣️ PRINCIPIO DE COPYS (no-negociable, aplica a TODO el plan):** cada texto que ve
el usuario — nombres de nodos, ayudas, errores, botones, mensajes del copiloto,
estados de ejecución — DEBE entenderlo cualquier persona sin conocimientos
técnicos. Regla práctica: si tu mamá no lo entiende, está mal escrito. Nada de
jerga (`payload`, `boolean`, `stdout`, `HTTP 500`, `null`). Errores en lenguaje
humano + qué hacer para resolverlo (ej. NO "Request failed 401" → SÍ "La conexión
con Stripe fue rechazada: revisá que la API key sea correcta en Integraciones").
Lo técnico (JSON crudo, códigos) sólo en "modo avanzado".

---

## File Structure

| Archivo | Responsabilidad |
|---------|-----------------|
| `apps/web/lib/flows/node-registry.ts` | **Fuente de verdad**: definición declarativa de cada nodo (id, categoría, copys, `fields[]`, defaults). Sin lógica de ejecución. |
| `apps/web/lib/flows/node-registry.test.ts` | Tests del registro (integridad, defaults, schemas válidos). |
| `apps/web/lib/flows/field-types.ts` | Tipos de campo del inspector (`text`, `textarea`, `select`, `agent-picker`, `kb-picker`, `integration-action`, `variable`, `code`, `json`, `boolean`, `number`, `key-value`). |
| `apps/web/components/flows/NodePalette.tsx` | Palette agrupado por categoría, derivado del registry (reemplaza el `Sidebar` inline actual). |
| `apps/web/components/flows/inspector/InspectorForm.tsx` | Inspector auto-generado desde `fields[]` (reemplaza el `Inspector` inline). Renderiza help, ejemplos, validación. |
| `apps/web/components/flows/inspector/fields/*.tsx` | Un componente por tipo de campo (FieldText, FieldSelect, FieldAgentPicker, FieldVariable, etc.). |
| `apps/web/components/flows/VariablePicker.tsx` | Autocompletado de `{{variables}}` del contexto del flujo. |
| `apps/web/components/flows/copilot/CopilotPanel.tsx` | Solapa lateral de chat del copiloto. |
| `apps/web/lib/flows/copilot-tools.ts` | Tools de function-calling del copiloto que mutan el grafo. |
| `apps/web/app/api/flows/[id]/copilot/route.ts` | Endpoint del copiloto (SSE): recibe mensaje + grafo actual, devuelve mutaciones + texto. |
| `apps/web/lib/flows/nodes/excel-formulas.ts` | Motor de fórmulas para el nodo Spreadsheet (batería de fórmulas tipo Excel). |
| `apps/web/lib/flow-engine.ts` | **Modificar**: agregar ejecutores para los nodos nuevos (`integration`, `kb_search`, `spreadsheet`, triggers). |
| `apps/web/lib/flows/templates.ts` | Plantillas de flujos pre-armadas. |
| `apps/web/components/flows/FlowBuilder.tsx` | **Modificar**: usar NodePalette + InspectorForm + CopilotPanel; empty state guiado. |
| `apps/web/lib/i18n` (catálogos) | Copys nuevos (es/en/pt-BR). |
| `.agents/features/flow-engine.md` | **Modificar**: changelog + nuevos nodos. |

---

## Phase 1 — Node Registry (fundación, todo deriva de acá)

### Task 1: Field types

**Files:**
- Create: `apps/web/lib/flows/field-types.ts`

- [ ] **Step 1: Definir los tipos de campo del inspector**

```ts
// apps/web/lib/flows/field-types.ts
export type FieldType =
  | "text" | "textarea" | "number" | "boolean"
  | "select" | "key-value" | "json" | "code"
  | "agent-picker" | "kb-picker" | "integration-action" | "channel-picker"
  | "variable" | "duration" | "cron";

export interface FieldDef {
  key: string;                 // path en config (ej. "url", "condition.op")
  label: string;               // copy humano
  type: FieldType;
  placeholder?: string;
  help?: string;               // instrucción/explicación (clave para intuitividad)
  example?: string;            // ejemplo concreto
  required?: boolean;
  advanced?: boolean;          // se esconde bajo "modo avanzado"
  options?: { value: string; label: string }[]; // para select
  dependsOn?: { key: string; value: string };    // mostrar condicional
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/flows/field-types.ts
git commit -m "feat(flows): field type definitions for declarative inspector"
```

### Task 2: Node registry skeleton + first 3 nodes

**Files:**
- Create: `apps/web/lib/flows/node-registry.ts`
- Test: `apps/web/lib/flows/node-registry.test.ts`

- [ ] **Step 1: Escribir el test del registry**

```ts
// node-registry.test.ts
import { describe, it, expect } from "vitest";
import { NODE_REGISTRY, getNodeDef, listNodesByCategory } from "./node-registry";

describe("node-registry", () => {
  it("every node has id, category, copys and fields", () => {
    for (const def of Object.values(NODE_REGISTRY)) {
      expect(def.id).toBeTruthy();
      expect(def.category).toBeTruthy();
      expect(def.title.es).toBeTruthy();
      expect(def.summary.es).toBeTruthy();   // "qué hace" en humano
      expect(Array.isArray(def.fields)).toBe(true);
    }
  });
  it("agent node exists and has an agent-picker field", () => {
    const agent = getNodeDef("agent");
    expect(agent?.fields.some((f) => f.type === "agent-picker")).toBe(true);
  });
  it("groups nodes by category", () => {
    const groups = listNodesByCategory();
    expect(groups.find((g) => g.category === "trigger")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test (debe fallar)**

Run: `pnpm --filter @orchester/web test node-registry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementar el registry con tipos + 3 nodos (trigger, agent, condition)**

```ts
// node-registry.ts
import type { FieldDef } from "./field-types";
import type { FlowNodeType } from "@/lib/flow-engine";

export type NodeCategory = "trigger" | "ai" | "logic" | "apps" | "data" | "actions";

export interface NodeDef {
  id: FlowNodeType | string;     // matchea el ejecutor del engine
  category: NodeCategory;
  icon: string;                  // nombre de ícono lucide
  accent: string;                // color del nodo (hex)
  title: { es: string; en: string; "pt-BR": string };
  summary: { es: string; en: string; "pt-BR": string }; // 1 línea "qué hace"
  fields: FieldDef[];
  defaults?: Record<string, unknown>;
}

export const NODE_REGISTRY: Record<string, NodeDef> = {
  trigger_manual: {
    id: "trigger", category: "trigger", icon: "Play", accent: "#10b981",
    title: { es: "Inicio manual", en: "Manual start", "pt-BR": "Início manual" },
    summary: { es: "Arranca el flujo cuando lo ejecutás a mano o por API.", en: "Starts when run manually or via API.", "pt-BR": "Inicia quando executado manualmente ou via API." },
    fields: [],
  },
  agent: {
    id: "agent", category: "ai", icon: "Bot", accent: "#8b5cf6",
    title: { es: "Agente", en: "Agent", "pt-BR": "Agente" },
    summary: { es: "Le pasa el mensaje a un agente de IA y usa su respuesta.", en: "Sends the message to an AI agent and uses its reply.", "pt-BR": "Envia a mensagem a um agente de IA e usa a resposta." },
    fields: [
      { key: "agentId", label: "Agente", type: "agent-picker", required: true, help: "Elegí qué agente responde en este paso." },
      { key: "prompt", label: "Instrucción extra (opcional)", type: "textarea", help: "Texto que se antepone al mensaje. Podés usar {{variables}}.", example: "Respondé en tono formal.", advanced: true },
    ],
  },
  condition: {
    id: "condition", category: "logic", icon: "GitBranch", accent: "#f59e0b",
    title: { es: "Si… entonces", en: "If… then", "pt-BR": "Se… então" },
    summary: { es: "Toma un camino u otro según una condición.", en: "Branches based on a condition.", "pt-BR": "Ramifica conforme uma condição." },
    fields: [
      { key: "left", label: "Valor a comparar", type: "variable", required: true, help: "Ej. {{message}} o {{agent.output}}.", example: "{{message}}" },
      { key: "op", label: "Comparación", type: "select", required: true, options: [
        { value: "==", label: "es igual a" }, { value: "!=", label: "es distinto de" },
        { value: "contains", label: "contiene" }, { value: ">", label: "es mayor que" },
        { value: "<", label: "es menor que" }, { value: ">=", label: "mayor o igual" }, { value: "<=", label: "menor o igual" },
      ] },
      { key: "right", label: "Comparar contra", type: "text", required: true, example: "urgente" },
    ],
  },
};

export function getNodeDef(id: string): NodeDef | undefined { return NODE_REGISTRY[id]; }
export function listNodesByCategory(): { category: NodeCategory; nodes: NodeDef[] }[] {
  const order: NodeCategory[] = ["trigger", "ai", "logic", "apps", "data", "actions"];
  return order.map((category) => ({ category, nodes: Object.values(NODE_REGISTRY).filter((n) => n.category === category) }));
}
```

- [ ] **Step 4: Run test (debe pasar)**

Run: `pnpm --filter @orchester/web test node-registry`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/flows/node-registry.ts apps/web/lib/flows/node-registry.test.ts
git commit -m "feat(flows): declarative node registry (source of truth for palette/inspector/copilot)"
```

### Task 3: Poblar el registry con TODOS los nodos existentes

Agregar al `NODE_REGISTRY` los 15 nodos que el engine ya ejecuta, con copys humanos + fields. Reescribir copys:

- `switch` → "Elegir camino" · `transform` → "Modificar datos" · `delay` → "Esperar un rato" · `notify` → "Avisar" · `code` → "Código (avanzado)" · `loop_for_each` → "Repetir por cada" · `parallel` → "En paralelo" · `try_catch` → "Intentar / si falla" · `subflow` → "Sub-flujo" · `wait_human` → "Esperar a una persona" · `http` → "Llamar una API (HTTP)".

- [ ] **Step 1:** Agregar cada nodo con sus `fields` (mismo patrón que Task 2). Para `http`: fields url/method/headers(key-value)/body(json)/auth. Para `code`: field `code` (type code) con help "JS sandboxed; recibe `input`, devolvé un objeto". Marcar `code`/`http` raw como `advanced` para el modo no-técnico.
- [ ] **Step 2:** Extender el test: `expect(Object.keys(NODE_REGISTRY).length).toBeGreaterThanOrEqual(14)`.
- [ ] **Step 3:** Run test → PASS. **Step 4:** Commit `feat(flows): register all existing engine nodes with human-friendly copy`.

---

## Phase 2 — Inspector auto-generado (impacto inmediato en intuitividad)

### Task 4: Field components

**Files:**
- Create: `apps/web/components/flows/inspector/fields/FieldText.tsx`, `FieldSelect.tsx`, `FieldTextarea.tsx`, `FieldBoolean.tsx`, `FieldNumber.tsx`, `FieldKeyValue.tsx`, `FieldJson.tsx`, `FieldCode.tsx`, `FieldAgentPicker.tsx`, `FieldKbPicker.tsx`, `FieldIntegrationAction.tsx`, `FieldChannelPicker.tsx`, `FieldVariable.tsx`, `FieldDuration.tsx`, `FieldCron.tsx`

- [ ] **Step 1:** Cada componente recibe `{ field: FieldDef; value; onChange }` y renderiza el control + `label` + `help` (texto chico `text-muted`) + `example` (placeholder o hint). Usar tokens de tema (`bg-elevated`, `text-strong`, `border-line`) y `labelPlacement` para HeroUI si aplica. Seguir `docs/UI-DESIGN-SYSTEM.md`.
- [ ] **Step 2:** `FieldAgentPicker`/`FieldKbPicker`/`FieldChannelPicker`/`FieldIntegrationAction` fetchean sus opciones de las APIs existentes (`/api/agents`, `/api/knowledge-bases`, `/api/channels`, `/api/integrations`).
- [ ] **Step 3:** Commit `feat(flows): inspector field components (per FieldType)`.

### Task 5: InspectorForm + "qué hace" + modo avanzado

**Files:**
- Create: `apps/web/components/flows/inspector/InspectorForm.tsx`
- Modify: `apps/web/components/flows/FlowBuilder.tsx` (reemplazar `Inspector` por `InspectorForm`)

- [ ] **Step 1:** `InspectorForm` toma el `node`, busca su `NodeDef`, muestra arriba el `title` + `summary` ("qué hace este nodo") + botón "Probar este paso". Renderiza los `fields` no-avanzados; los `advanced` bajo un `<details>` "Avanzado". Aplica `dependsOn` para campos condicionales. Botón "Ver ejemplo / docs".
- [ ] **Step 2:** Validación required → resaltar campos faltantes antes de permitir ejecutar.
- [ ] **Step 3:** Commit `feat(flows): declarative auto-generated inspector with instructions + advanced mode`.

### Task 6: VariablePicker

- [ ] **Step 1:** Componente que sugiere `{{variables}}` disponibles (input del flujo, outputs de nodos previos: `{{<nodeLabel>.output}}`). Inserta en el campo enfocado.
- [ ] **Step 2:** Integrar en `FieldVariable` y `FieldTextarea`/`FieldText` (botón "{{}}").
- [ ] **Step 3:** Commit `feat(flows): variable picker with autocomplete`.

---

## Phase 3 — Node library mega (reusar connectors + triggers + KB + Excel)

### Task 7: Integration node (reusa el connector framework)

**Files:**
- Modify: `apps/web/lib/flow-engine.ts` (executor `integration`)
- Modify: `apps/web/lib/flows/node-registry.ts` (nodo `integration`)

- [ ] **Step 1:** Nodo `integration` con fields: `integrationId` (type `integration-action` → elige integración + acción configurada), `input` (key-value/json). `FieldIntegrationAction` lista las integraciones conectadas (`/api/integrations`) y sus acciones (del registry de connectors).
- [ ] **Step 2:** Executor en el engine: `if (node.type === "integration") { const { runIntegrationAction } = await import("./integrations/store"); ctx.variables[node.label] = await runIntegrationAction(workspaceId, config.integrationId, config.action, resolveVars(config.input, ctx)); }`.
- [ ] **Step 3:** Test del executor con un connector mock. **Step 4:** Commit `feat(flows): integration node reusing connector framework`.

### Task 8: Real triggers (webhook, schedule, on-message, manual)

**Files:**
- Modify: `node-registry.ts` (`trigger_webhook`, `trigger_schedule`, `trigger_message`, `trigger_manual`)
- Modify: `apps/web/lib/flow-engine.ts` / scheduling (ya existe `flow_webhook` + `flows/[id]/schedules`)

- [ ] **Step 1:** Registrar los 4 triggers con sus fields (webhook → muestra la URL del secret; schedule → field `cron` con presets "cada hora/día"; message → `channel-picker`). El trigger no "ejecuta" — define cómo arranca el flujo (ya hay infra: `flow_webhook`, schedules).
- [ ] **Step 2:** Wirear: al guardar un flujo con `trigger_webhook`, crear/mostrar el `flow_webhook`; con `trigger_schedule`, crear el schedule. Reusar `/api/flows/[id]/webhooks` y `/schedules`.
- [ ] **Step 3:** Commit `feat(flows): real trigger nodes (webhook, schedule, on-message, manual)`.

### Task 9: Knowledge Base node

- [ ] **Step 1:** Nodo `kb_search` (category `data`): fields `kbId` (kb-picker), `query` (variable), `topK` (number). Executor reusa `executeTool("knowledge_search", …)`. Nodo `kb_ingest` (opcional, avanzado): agrega texto a una KB.
- [ ] **Step 2:** Commit `feat(flows): knowledge base search/ingest nodes`.

### Task 10: Spreadsheet node con batería de fórmulas

**Files:**
- Create: `apps/web/lib/flows/nodes/excel-formulas.ts` + `.test.ts`
- Modify: `node-registry.ts` + `flow-engine.ts`

- [ ] **Step 1 (TDD):** Test de fórmulas: SUM, AVERAGE, COUNT, MIN, MAX, IF, CONCAT, ROUND, ABS, VLOOKUP-like, MAP/FILTER sobre arrays, etc.
- [ ] **Step 2:** Implementar un evaluador seguro de fórmulas (sin `eval`; parser propio o librería MIT como `hot-formula-parser`/`formulajs` — verificar licencia MIT antes de agregar). `formulajs` es MIT y trae ~400 funciones de Excel → preferir esa.
- [ ] **Step 3:** Nodo `spreadsheet`: field `formula` (code) + `data` (json/variable). Executor evalúa la fórmula contra los datos.
- [ ] **Step 4:** Commit `feat(flows): spreadsheet node with Excel-style formula battery (formulajs)`.

### Task 11: NodePalette agrupado + empty state guiado + plantillas

**Files:**
- Create: `apps/web/components/flows/NodePalette.tsx`, `apps/web/lib/flows/templates.ts`
- Modify: `FlowBuilder.tsx`

- [ ] **Step 1:** `NodePalette` deriva de `listNodesByCategory()`: secciones *Disparadores · IA · Lógica · Conectar apps · Datos · Acciones*, cada nodo con su `title` + tooltip `summary`. Buscador.
- [ ] **Step 2:** `templates.ts`: 4-6 plantillas (`{ name, description, nodes, edges }`). Empty state del canvas: "Empezá de una plantilla" con cards + "o arrastrá un nodo".
- [ ] **Step 3:** Commit `feat(flows): grouped node palette + flow templates + guided empty state`.

---

## Phase 4 — Copiloto de IA (armá el flujo conversando)

### Task 12: Copilot tools (mutaciones del grafo)

**Files:**
- Create: `apps/web/lib/flows/copilot-tools.ts`

- [ ] **Step 1:** Definir tools de function-calling (formato `ToolDefinitionForLlm`): `add_node(type, label, config, position)`, `connect_nodes(sourceId, targetId, sourceHandle?)`, `update_node_config(nodeId, config)`, `delete_node(nodeId)`, `list_available_nodes()` (devuelve el registry), `list_workspace_resources()` (agents, KBs, integraciones, canales). El system prompt incluye el catálogo del registry para que el LLM sepa qué nodos existen y sus fields.
- [ ] **Step 2:** Un reductor `applyMutations(graph, mutations)` puro + test (dado un grafo y una lista de tool-calls, produce el grafo nuevo).
- [ ] **Step 3:** Commit `feat(flows): copilot graph-mutation tools + pure reducer`.

### Task 13: Copilot endpoint (SSE)

**Files:**
- Create: `apps/web/app/api/flows/[id]/copilot/route.ts`

- [ ] **Step 1:** POST recibe `{ messages, graph }`. Llama `llmCall` con las tools de Task 12 y un system prompt que explica: "Sos un copiloto que arma flujos. Usá las tools para agregar/conectar/configurar nodos. Si te dan una URL de API y un caso de uso, creá los nodos HTTP/Integration necesarios y conectalos." Devuelve `{ reply, mutations }` (SSE para streaming del texto + las tool-calls).
- [ ] **Step 2:** Auth por sesión + workspace (como el resto de `/api/flows`). Rate-limit LLM_HEAVY.
- [ ] **Step 3:** Commit `feat(flows): copilot SSE endpoint (llmCall + graph tools)`.

### Task 14: CopilotPanel UI

**Files:**
- Create: `apps/web/components/flows/copilot/CopilotPanel.tsx`
- Modify: `FlowBuilder.tsx` (solapa lateral: Inspector | Copiloto)

- [ ] **Step 1:** Panel de chat (tabs con el Inspector). Input + historial. Al recibir `mutations`, las aplica al canvas con `applyMutations` y resalta los nodos nuevos. Botón "Deshacer sugerencia".
- [ ] **Step 2:** Quick prompts: "Pegá una URL de API y decime qué querés hacer", "Armá un flujo de soporte". Aceptar pegar una URL → el copiloto crea el nodo HTTP configurado.
- [ ] **Step 3:** Commit `feat(flows): AI copilot panel — builds/edits the flow conversationally`.

### Task 15: Copiloto que EXPLICA y DEBUGGEA (no solo construye)

**Files:**
- Modify: `apps/web/lib/flows/copilot-tools.ts` (tools `read_flow`, `read_last_run`)
- Modify: `apps/web/app/api/flows/[id]/copilot/route.ts`

- [ ] **Step 1:** Agregar tools de lectura: `read_flow()` (devuelve el grafo en lenguaje simple) y `read_last_run(runId?)` (devuelve qué hizo cada paso y dónde falló). El system prompt suma: "Si te preguntan qué hace el flujo, explicalo en lenguaje simple paso a paso. Si te preguntan por qué falló, leé la última corrida y explicá la causa + cómo arreglarlo, sin jerga."
- [ ] **Step 2:** Quick prompts en el panel: "¿Qué hace este flujo?" y "¿Por qué falló la última vez?".
- [ ] **Step 3:** Commit `feat(flows): copilot explains + debugs flows in plain language`.

---

## Phase 5 — Observabilidad & debugging (ver el flujo correr)

### Task 16: Estado de ejecución en vivo sobre el canvas

**Files:**
- Modify: `apps/web/lib/flow-engine.ts` (emitir eventos de progreso por nodo)
- Create: `apps/web/app/api/flows/[id]/run-stream/route.ts` (SSE de progreso)
- Modify: `apps/web/components/flows/FlowBuilder.tsx` (pintar estado por nodo)

- [ ] **Step 1:** El engine emite, por cada nodo: `running` → `done`/`failed` + duración + tokens/costo (si es nodo de IA, reusa el cost tracking ya existente). Persistir en `flow_run` el detalle por nodo (input/output/estado).
- [ ] **Step 2:** Endpoint SSE que streamea esos eventos al ejecutar. El canvas ilumina el nodo activo, marca ✓/✗, y muestra un badge con duración + costo. Aristas "animan" el paso de datos.
- [ ] **Step 3:** Copys: estados en humano — "Ejecutando…", "Listo", "Falló" (no "running/success/error"). Commit `feat(flows): live per-node execution state on the canvas (with cost)`.

### Task 17: Inspector de corridas (debugging — qué recibió y devolvió cada nodo)

**Files:**
- Create: `apps/web/components/flows/RunInspector.tsx`
- Modify: `apps/web/app/api/flows/[id]/runs/route.ts` (incluir detalle por nodo)

- [ ] **Step 1:** Panel "Corridas": lista de ejecuciones pasadas (cuándo, resultado, duración, costo). Al abrir una, se ve cada paso con **qué entró y qué salió** en formato legible (no JSON crudo salvo "modo avanzado"). El nodo que falló se muestra en rojo con el error **en lenguaje humano + cómo resolverlo**.
- [ ] **Step 2:** Botón "Reintentar esta corrida" (replay con el mismo input).
- [ ] **Step 3:** Commit `feat(flows): run inspector — per-node input/output + plain-language errors`.

### Task 18: Errores inline en el nodo

- [ ] **Step 1:** Si un nodo falló en la última corrida, mostrar un badge rojo sobre el nodo en el canvas con tooltip = mensaje humano. Click → abre el RunInspector en ese paso.
- [ ] **Step 2:** Commit `feat(flows): inline node error badges linking to the run inspector`.

---

## Phase 6 — Productividad de autoría

### Task 19: Pin data + dry-run (probar sin efectos reales)

**Files:**
- Modify: `apps/web/lib/flow-engine.ts` (modo `dryRun` + `pinnedData` por nodo)
- Modify: `InspectorForm.tsx` (UI de pin)

- [ ] **Step 1:** "Fijar datos de prueba" por nodo: guardás un input de ejemplo y al iterar el flujo usa ese input fijo en vez de re-ejecutar lo anterior (acelera el armado). Copy: "Usar estos datos de prueba".
- [ ] **Step 2:** Modo "Probar sin enviar nada" (dry-run): los nodos con efectos (email, DB write, integración) se simulan y muestran "qué haría" sin hacerlo. Toggle visible en el botón Ejecutar: "Ejecutar" / "Probar (sin efectos)".
- [ ] **Step 3:** Commit `feat(flows): pin test data per node + dry-run (no real side effects)`.

### Task 20: Panel de validación (avisar problemas antes de ejecutar)

**Files:**
- Create: `apps/web/lib/flows/validate.ts` + `.test.ts`
- Modify: `FlowBuilder.tsx`

- [ ] **Step 1 (TDD):** `validateFlow(graph, registry)` detecta: nodos sin configurar (campos `required` vacíos), nodos desconectados, flujo sin trigger, ciclos no permitidos. Devuelve issues con mensaje humano + el nodo culpable.
- [ ] **Step 2:** Banner/panel "Este flujo tiene N cosas para revisar" con lista clickeable (lleva al nodo). Bloquea "Ejecutar" si hay errores graves. Copys humanos ("Al nodo 'Avisar' le falta elegir a quién avisar").
- [ ] **Step 3:** Commit `feat(flows): pre-run validation panel with human-friendly issues`.

### Task 21: Edición cómoda (undo/redo, copiar/pegar, notas, auto-orden)

**Files:**
- Modify: `FlowBuilder.tsx`
- Create: `apps/web/components/flows/nodes/StickyNote.tsx`

- [ ] **Step 1:** Undo/redo (Cmd+Z / Cmd+Shift+Z) sobre el grafo; copiar/pegar/duplicar nodos (Cmd+C/V/D); multi-select.
- [ ] **Step 2:** Nodo "Nota" (sticky) para comentar el flujo. Botón "Ordenar" (auto-layout con dagre — MIT).
- [ ] **Step 3:** Commit `feat(flows): undo/redo, copy/paste, sticky notes, auto-layout`.

---

## Phase 7 — Copys i18n + docs

### Task 22: Catálogos i18n + docs

- [ ] **Step 1:** Mover todos los copys del registry a los catálogos `next-intl` (es/en/pt-BR) o mantener el registry trilingüe (ya lo es). Asegurar que el palette/inspector/estados/errores usan el locale activo. **Pasada final de copys**: revisar que TODO (nodos, ayudas, errores, estados, copiloto) cumpla el principio "lo entiende cualquier persona".
- [ ] **Step 2:** Actualizar `.agents/features/flow-engine.md` (changelog: registry, nodos nuevos, copiloto, observabilidad, autoría) y `docs/UI-DESIGN-SYSTEM.md` (patrones de node card, inspector field, estados de ejecución).
- [ ] **Step 3:** Commit `docs(flows): i18n copy + spec changelog for flow revamp`.

---

## Self-Review

**Spec coverage:**
- Híbrido técnico/no-técnico → Phase 1 (copys) + Phase 2 (modo avanzado) ✓
- Copiloto de IA que arma el flujo → Phase 4 ✓
- Reusar connectors → Task 7 ✓
- Triggers reales → Task 8 ✓
- Canales/integraciones disponibles → Tasks 7, 8 (channel-picker, integration-action) ✓
- Knowledge base → Task 9 ✓
- Nodo Excel con fórmulas → Task 10 ✓
- Inspector con instrucciones → Phase 2 ✓
- Biblioteca grande de nodos → registry + connectors auto-expuestos ✓
- Copiloto explica + debuggea → Task 15 ✓
- Ejecución en vivo + costo por nodo → Task 16 ✓
- Inspector de corridas (input/output por nodo, errores humanos) → Task 17, 18 ✓
- Pin data + dry-run → Task 19 ✓
- Validación pre-ejecución → Task 20 ✓
- Undo/redo, copiar/pegar, notas, auto-orden → Task 21 ✓
- Copys para cualquier humano → principio global + pasada final Task 22 ✓

**Riesgos / decisiones:**
- `formulajs` (MIT) para fórmulas Excel y `dagre` (MIT) para auto-layout — verificar licencia al agregar.
- El copiloto aplica mutaciones en el cliente (preview) antes de guardar → el usuario revisa.
- NO se copia código de n8n (licencia). Diseño propio inspirado en taxonomía.
- Ejecución en vivo: si los flujos corren en el worker (pg-boss), el SSE de progreso lee el detalle persistido en `flow_run` (no requiere conexión directa al worker).

**Type consistency:** `NodeDef.id` matchea `FlowNodeType` del engine para nodos core; los nodos nuevos (`integration`, `kb_search`, `spreadsheet`, triggers) se agregan al `FlowNodeType` union en `flow-engine.ts` en su task.

---

## Open questions (resolver durante ejecución)
- ¿El copiloto puede ejecutar el flujo o solo construirlo? (v1: solo construir + sugerir).
- OAuth de Google (Drive/Gmail/Sheets) necesita credenciales del operador → queda detrás del connector OAuth (scaffold ya existe).
