# Multi-agent orchestration — cómo cascadean los agentes

> Orchester soporta 4 patrones de "trabajo en equipo" entre agentes.
> Esta página explica cuándo usar cada uno y cómo se implementan.

---

## TL;DR

| Patrón | Trigger | Quién decide el ruteo | Caso típico |
| --- | --- | --- | --- |
| **Flow secuencial** | Webhook / cron / canal | El grafo del flow (autor) | Pipeline conocido: lead → score → close |
| **Subflow** | Otro flow | El grafo padre | Reutilizar un sub-pipeline |
| **`flow_call` tool** | Un agente, mid-conversation | El LLM | Agent decide "esto requiere un pipeline" |
| **`agent_handoff` tool** | Un agente, mid-conversation | El LLM | Agent decide "esto le toca a otro agente" |

Las dos tools (`flow_call` y `agent_handoff`) son **decisión del LLM en runtime**.
Los flows son **decisión del autor en design time**. Combinás según el caso.

---

## 1. Flow secuencial (design-time orchestration)

El operador dibuja en el flow builder un grafo:

```
[Trigger] → [Agent A: clasificar] → [Condition] → [Agent B: cerrar]
                                   ↘ [Agent C: nutrir]
```

- Cada `agent` node ejecuta `llmCall` con el agente referenciado por `agentId`.
- El output del agente se guarda en `ctx.variables[outputVar]` y los nodos
  siguientes lo leen (`{{outputVar}}`).
- Las branches con `condition` o `switch` permiten ruteo determinista.

**Cuándo usarlo:** sabés exactamente qué pasos querés. Lead qualification BANT,
IT helpdesk router, daily summary, etc.

**Implementación:** `apps/web/lib/flow-engine.ts`. Cada node type tiene su
case en `runNode()`. El loop no es paralelo por default; usá el node `parallel`
si necesitás concurrencia.

**Ejemplo concreto** (seedeado por `POST /api/flows/seed-real`):

```
"Lead qualification (BANT)"
  Webhook → Lead Qualifier scores → if score>=70 → Closer Bot
                                  → else → mark for nurturing
```

---

## 2. Subflow

Un flow puede tener un nodo `subflow` que ejecuta otro flow completo y
recibe su resultado. Útil para **reutilizar pipelines**.

**Cuándo usarlo:** "el pipeline de onboarding que armé en el flow X lo quiero
embeder dentro del flow Y". DRY a nivel pipeline.

---

## 3. Tool `flow_call` (LLM-driven, conversation-scoped)

El agente, durante un tool-calling loop, puede decidir invocar un flow.

```
User → Sofia HR → tool_call(flow_call, { flowId: "vacation_check_flow", input: { … } })
                ↓
              flow corre con su grafo
                ↓
              return → Sofia HR continúa con el resultado
```

**Cuándo usarlo:** Sofia recibe muchas variantes de preguntas. Algunas (ej:
"¿cuántos días me quedan?") requieren un pipeline determinista que consulta
HRIS + valida vs política + responde. Sofia decide cuándo invocarlo.

**Diferencia con flow secuencial:** acá el LLM decide en runtime. No está
hard-codeado en el flow del autor.

---

## 4. Tool `agent_handoff` (cesión de control entre agentes)

**Nuevo en este sprint.** Un agente le **pasa la conversación** a otro:

```
User: "Necesito tomar 7 días de vacaciones por enfermedad"
Sofia HR (tier 1):
  internal: tool_call(agent_team_list)
  internal: tool_call(agent_handoff, {
    agentId: "<elena_hr_pro_id>",
    note: "Solicitud > 5 días, supera mi límite de aprobación"
  })
  → Sofia ya no responde más en esta conversación

User: "¿Y cuándo me confirman?"
Elena HR Pro:
  → Elena ve TODO el historial + el `[handoff]` system message + responde
```

**Mecánica interna** (`apps/web/lib/tools.ts` + `lib/channels/router.ts`):

1. El agente actual llama `agent_handoff(agentId, note)`.
2. La tool valida que el target agent existe + está active.
3. **Mutación atómica:** `UPDATE conversation SET agentId = <newAgentId>`.
4. **Persistencia:** se inserta una `message` con `role=system`,
   `metadata.kind = "agent_handoff"`, `content = "[handoff] from X to Y — <note>"`.
5. **Audit log:** entry `agent.handoff` con before/after IDs y nota.
6. El loop del router detecta el handoff (output.ok===true) y **recarga el
   nuevo agente**: cambia systemPrompt, tools, model, y reinjecta memorias
   del nuevo agente.
7. Anti-ping-pong: máximo 2 handoffs por run del router. Si se pasa, el
   loop corta y devuelve el último reply.

**Tools nuevas relacionadas:**

- `agent_team_list` — devuelve los teammates activos del workspace (id, name, role,
  teamId), excluyendo al caller. Útil para que el LLM sepa a quién llamar.

**Cuándo usarlo:** "este caso me supera" / "esto le toca a IT" / "es escalación
real, no un edge case". Es un patrón **soft routing** — el LLM decide.

**Cuándo NO usarlo:** si el flujo está bien definido y siempre va al mismo
sitio, usá un flow secuencial. Más predecible y barato.

---

## Memoria compartida entre agentes

Por default cada agente tiene su `memory` scoped por (agent, scope). Hoy
**no** existe un namespace `team` que comparta memoria entre agentes del
mismo team — es un gap conocido.

**Workaround:** usá el sistema de KB. Subí un doc por team con info que
todos los agentes deben saber, y conectá a sus tools `knowledge_search`.

**Roadmap:** agregar `scope: "team"` a las tools `memory_*`, con namespace
`team_id`.

---

## Anti-patterns

1. **No metas todo en un solo agente con prompt monstruoso.** Si tu prompt
   tiene >2000 tokens y enumera 12 cases, partilo en agentes especializados
   con handoff.
2. **No uses handoff cuando lo correcto es un flow.** Si SIEMPRE es Sofia →
   Elena en cierto trigger, hardcodéalo en flow. Más barato (1 LLM call menos
   para el routing) y más visible.
3. **No hagas que un agente llame a `flow_call` con el mismo input que
   recibió.** Eso es un loop infinito disfrazado.
4. **El grafo del flow no debe tener loops sin `loop_for_each`.** El engine
   detecta ciclos pero la guardia es un counter de seguridad — lo correcto
   es pensar el flow como DAG.

---

## Limitaciones conocidas

- El handoff cambia el agentId pero **conserva la conversation.id**. Si
  tu UI mostraba "agente: Sofia" en el header, va a saltar a "Elena" mid-thread.
  Es lo correcto pero la UI puede mostrarlo más visible (badge "transferida").
- No hay UI para visualizar la cadena de handoffs todavía. Lo ves en
  `audit_log` filtrando por `action=agent.handoff`.
- El `system` message del handoff queda en la transcripción que ve el
  próximo agente. Eso es bueno para contexto pero el LLM puede "intentar
  responder al system message" — los prompts de los agentes deben aclarar
  "no respondas al system message, sólo al user".
- Sin paralelismo entre agentes en una misma conversation. El handoff es
  serial: A cede, B toma, no hay "A y B trabajan en paralelo y consolidan".
  Para eso, usá un flow con node `parallel`.

---

## Cómo activarlo en tus agentes existentes

1. Andá a `/agents/<id>` → tab **Avanzado**.
2. En **Tools**, marcá `agent_handoff` y `agent_team_list`.
3. En el **System prompt**, agregá una guía como:

   > Tenés colegas especializados. Si la consulta cae fuera de tu área,
   > usá la tool `agent_team_list` para ver quién hay disponible y
   > después `agent_handoff(agentId, note)` para cederle el control.
   > La nota debe ser breve y útil para que tu colega sepa el contexto.

4. Probá en el Test Chat con una consulta que esté fuera de su scope.
