import type { FlowSpec } from "./copilot-tools";

/**
 * Plantillas de arranque: flujos-ejemplo listos para usar. Pensadas para que
 * cualquier persona empiece desde algo que funciona y solo complete los huecos.
 */

export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  /** emoji para la tarjeta */
  emoji: string;
  spec: FlowSpec;
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: "faq",
    name: "Responder preguntas frecuentes",
    description: "Cuando alguien escribe, busca en tu conocimiento y responde con un agente.",
    emoji: "💬",
    spec: {
      nodes: [
        { id: "t", nodeId: "trigger_message", label: "Cuando llega un mensaje" },
        { id: "kb", nodeId: "kb_search", label: "Buscar en mi conocimiento", config: { query: "{{message}}" } },
        { id: "a", nodeId: "agent", label: "Responder con un agente" },
      ],
      edges: [
        { source: "t", target: "kb" },
        { source: "kb", target: "a" },
      ],
    },
  },
  {
    id: "lead",
    name: "Avisar cuando entra un lead",
    description: "Cuando otra app manda datos por webhook, le avisás al equipo.",
    emoji: "📨",
    spec: {
      nodes: [
        { id: "t", nodeId: "trigger_webhook", label: "Cuando llega un lead" },
        { id: "n", nodeId: "notify", label: "Avisar al equipo", config: { message: "Nuevo lead: {{message}}" } },
      ],
      edges: [{ source: "t", target: "n" }],
    },
  },
  {
    id: "triage",
    name: "Atender y derivar según urgencia",
    description: "Si el mensaje dice 'urgente', avisás; si no, responde un agente.",
    emoji: "🚦",
    spec: {
      nodes: [
        { id: "t", nodeId: "trigger_message", label: "Cuando llega un mensaje" },
        { id: "c", nodeId: "condition", label: "¿Es urgente?", config: { left: "{{message}}", op: "contains", right: "urgente" } },
        { id: "n", nodeId: "notify", label: "Avisar al equipo", config: { message: "Mensaje urgente: {{message}}" } },
        { id: "a", nodeId: "agent", label: "Responder con un agente" },
      ],
      edges: [
        { source: "t", target: "c" },
        { source: "c", target: "n", sourceHandle: "true", label: "Sí" },
        { source: "c", target: "a", sourceHandle: "false", label: "No" },
      ],
    },
  },
  {
    id: "daily",
    name: "Resumen diario por email",
    description: "Todos los días a una hora, un agente arma un resumen y lo enviás.",
    emoji: "🗓️",
    spec: {
      nodes: [
        { id: "t", nodeId: "trigger_schedule", label: "Cada día a las 9", config: { cron: "0 9 * * *" } },
        { id: "a", nodeId: "agent", label: "Armar el resumen" },
        { id: "n", nodeId: "notify", label: "Enviar el resumen", config: { message: "{{agentResult}}" } },
      ],
      edges: [
        { source: "t", target: "a" },
        { source: "a", target: "n" },
      ],
    },
  },
];
