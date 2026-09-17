/**
 * Única fuente de verdad de los tipos de nodo (A7): la unión se deriva de este
 * const, así no se duplica el listado. (El pgEnum `flow_node_type` del schema es
 * intencionalmente independiente para no acoplar una migración a este archivo;
 * mantenerlos en sync sigue siendo manual — ver el follow-up del executeNode
 * handler-map en docs/superpowers/audits.)
 *
 * Client-safe on purpose: `validate-stored.ts` needs it to check raw stored
 * types before normalization, without dragging in `flow-engine.ts` (server-only).
 */
export const FLOW_NODE_TYPES = [
  "trigger",
  "agent",
  "kb_search",
  "generate_image",
  "embed_text",
  "llm_prompt",
  "generate_video",
  "text_to_speech",
  "transcribe",
  "rerank",
  "generate_avatar",
  "generate_music",
  "ocr_extract",
  "condition",
  "switch",
  "http",
  "integration",
  "transform",
  "spreadsheet",
  "delay",
  "notify",
  "code",
  "loop_for_each",
  "parallel",
  "try_catch",
  "subflow",
  "wait_human",
  "note",
  "end",
] as const;

export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];
