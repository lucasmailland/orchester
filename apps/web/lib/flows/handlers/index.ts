import "server-only";
import type { NodeHandler, FlowNodeType } from "@/lib/flow-engine";

import {
  generate_image,
  generate_video,
  text_to_speech,
  transcribe,
  rerank,
  generate_avatar,
  generate_music,
  ocr_extract,
  embed_text,
  llm_prompt,
  kb_search,
} from "./ai";

import {
  condition,
  switch_node,
  loop_for_each,
  parallel,
  try_catch,
  subflow,
  wait_human,
  delay,
  end,
} from "./control";

import { http, integration, notify } from "./io";

import { trigger, agent, transform, code, spreadsheet, note } from "./data";

export const NODE_HANDLERS: Record<Exclude<FlowNodeType, "end">, NodeHandler> = {
  trigger,
  agent,
  kb_search,
  generate_image,
  embed_text,
  llm_prompt,
  generate_video,
  text_to_speech,
  transcribe,
  rerank,
  generate_avatar,
  generate_music,
  ocr_extract,
  condition,
  switch: switch_node,
  http,
  integration,
  transform,
  spreadsheet,
  delay,
  notify,
  code,
  loop_for_each,
  parallel,
  try_catch,
  subflow,
  wait_human,
  note,
};

// Re-export end handler in case it's needed by tests or other consumers.
export { end };
