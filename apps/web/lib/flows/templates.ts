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
    id: "chatbot-support-ticket",
    name: "Ticket de soporte desde el chatbot",
    description:
      "Recibe un caso del chatbot de Fichap, busca si ya existe un ticket parecido y solo crea uno nuevo si hace falta.",
    emoji: "🎫",
    spec: {
      nodes: [
        {
          id: "t",
          nodeId: "trigger_webhook",
          label: "Cuando el chatbot reporta un caso",
        },
        {
          // La razón por la que el chatbot no le habla a Odoo directamente.
          // Un bot de soporte recibe el mismo problema cinco veces; sin este
          // paso son cinco tickets y la cola deja de servir.
          id: "buscar",
          nodeId: "integration",
          label: "Buscar un ticket parecido",
          config: {
            integrationId: "odoo::search_tickets",
            input: { query: "{{name}}", limit: 5 },
            outputVar: "similares",
          },
        },
        {
          id: "hay",
          nodeId: "condition",
          label: "¿Ya existe uno?",
          // search_tickets answers { tickets }, and the integration node
          // stores that object under outputVar as-is — hence `.tickets`.
          // The engine expects left/op/right, not a free-form expression.
          config: { left: "{{similares.tickets.length}}", op: ">", right: "0" },
        },
        {
          // Camino del duplicado: el caso igual queda registrado, como nota
          // interna en el ticket que ya existe. Descartarlo en silencio
          // perdería que el problema afecta a más de una persona.
          id: "nota",
          nodeId: "integration",
          label: "Sumar el caso al ticket existente",
          config: {
            integrationId: "odoo::post_note",
            input: {
              model: "helpdesk.ticket",
              id: "{{similares.tickets.0.id}}",
              body_text:
                "Reportado también desde el chatbot de soporte.\n\nCategoría: {{category}}\nReporta: {{reporter.username}} (empresa {{reporter.companyId}})\nAfectado: {{affectedColleagueName}}\n\n{{description_text}}",
            },
            outputVar: "notaResultado",
          },
        },
        {
          id: "crear",
          nodeId: "integration",
          label: "Crear el ticket",
          config: {
            integrationId: "odoo::create_ticket",
            // La prioridad, el equipo y las tags las decide chatbot-service a
            // partir de su tabla de categorías, que copia el mapeo que ya usa
            // la landing pública. Así un ticket del bot cae en la misma cola,
            // con el mismo color, que uno del formulario web.
            input: {
              name: "{{name}}",
              description_text:
                "{{description_text}}\n\n— Reportado desde el chatbot de soporte por {{reporter.username}} (empresa {{reporter.companyId}}). Afectado: {{affectedColleagueName}}. Categoría: {{category}}.",
              priority: "{{priority}}",
              team_id: "{{team_id}}",
              tag_ids: "{{tag_ids}}",
            },
            outputVar: "ticket",
          },
        },
      ],
      edges: [
        { source: "t", target: "buscar" },
        { source: "buscar", target: "hay" },
        // The engine only follows the edge whose sourceHandle matches the
        // condition's result; an edge without one is never taken.
        { source: "hay", target: "nota", sourceHandle: "true" },
        { source: "hay", target: "crear", sourceHandle: "false" },
      ],
    },
  },
  {
    id: "faq",
    name: "Responder preguntas frecuentes",
    description: "Cuando alguien escribe, busca en tu conocimiento y responde con un agente.",
    emoji: "💬",
    spec: {
      nodes: [
        { id: "t", nodeId: "trigger_message", label: "Cuando llega un mensaje" },
        {
          id: "kb",
          nodeId: "kb_search",
          label: "Buscar en mi conocimiento",
          config: { query: "{{message}}" },
        },
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
        {
          id: "n",
          nodeId: "notify",
          label: "Avisar al equipo",
          config: { message: "Nuevo lead: {{message}}" },
        },
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
        {
          id: "c",
          nodeId: "condition",
          label: "¿Es urgente?",
          config: { left: "{{message}}", op: "contains", right: "urgente" },
        },
        {
          id: "n",
          nodeId: "notify",
          label: "Avisar al equipo",
          config: { message: "Mensaje urgente: {{message}}" },
        },
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
        {
          id: "t",
          nodeId: "trigger_schedule",
          label: "Cada día a las 9",
          config: { cron: "0 9 * * *" },
        },
        { id: "a", nodeId: "agent", label: "Armar el resumen" },
        {
          id: "n",
          nodeId: "notify",
          label: "Enviar el resumen",
          config: { message: "{{agentResult}}" },
        },
      ],
      edges: [
        { source: "t", target: "a" },
        { source: "a", target: "n" },
      ],
    },
  },
];
