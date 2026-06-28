import "server-only";
import type { NodeHandler } from "@/lib/flow-engine";
import { interpolate, resolveValue } from "@/lib/flows/runtime-helpers";

export const generate_image: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const model = String(cfg.model ?? "");
  if (!model) throw new Error("Falta elegir el modelo de imagen.");
  const prompt = interpolate(String(cfg.prompt ?? ""), ctx.variables);
  if (!prompt.trim()) throw new Error("Falta la descripción de la imagen.");
  const { generateImage } = await import("@/lib/ai/run");
  const res = await generateImage(workspaceId, model, {
    prompt,
    ...(cfg.size ? { size: String(cfg.size) } : {}),
  });
  const url = res.images[0]?.url ?? "";
  const outputVar = (cfg.outputVar as string) || "image";
  ctx.variables[outputVar] = url;
  helpers.setOutput({ count: res.images.length, mime: res.images[0]?.mime });
};

export const generate_video: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const model = String(cfg.model ?? "");
  if (!model) throw new Error("Falta elegir el modelo de video.");
  const prompt = interpolate(String(cfg.prompt ?? ""), ctx.variables);
  const { generateVideo } = await import("@/lib/ai/run");
  const res = await generateVideo(workspaceId, model, prompt);
  ctx.variables[(cfg.outputVar as string) || "video"] = res.url;
  helpers.setOutput({ url: res.url });
};

export const text_to_speech: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const model = String(cfg.model ?? "");
  if (!model) throw new Error("Falta elegir el modelo de voz.");
  const text = interpolate(String(cfg.text ?? ""), ctx.variables);
  if (!text.trim()) throw new Error("Falta el texto a decir.");
  const { textToSpeech } = await import("@/lib/ai/run");
  const res = await textToSpeech(
    workspaceId,
    model,
    text,
    cfg.voice ? String(cfg.voice) : undefined
  );
  ctx.variables[(cfg.outputVar as string) || "audio"] = res.url;
  helpers.setOutput({ url: res.url });
};

export const transcribe: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const model = String(cfg.model ?? "");
  if (!model) throw new Error("Falta elegir el modelo de transcripción.");
  const audioUrl = interpolate(String(cfg.audioUrl ?? ""), ctx.variables);
  if (!audioUrl.trim()) throw new Error("Falta la URL del audio.");
  const { transcribe: transcribeAi } = await import("@/lib/ai/run");
  const res = await transcribeAi(workspaceId, model, audioUrl);
  ctx.variables[(cfg.outputVar as string) || "texto"] = res.text;
  helpers.setOutput({ chars: res.text.length });
};

export const rerank: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const model = String(cfg.model ?? "");
  if (!model) throw new Error("Falta elegir el modelo de rerank.");
  const query = interpolate(String(cfg.query ?? ""), ctx.variables);
  const docsRaw = resolveValue(cfg.documents, ctx.variables);
  const documents = Array.isArray(docsRaw) ? docsRaw.map((d) => String(d)) : [];
  if (documents.length === 0)
    throw new Error("La 'Lista de textos' tiene que ser una lista con elementos.");
  const { rerank: rerankAi } = await import("@/lib/ai/run");
  const res = await rerankAi(
    workspaceId,
    model,
    query,
    documents,
    cfg.topN ? Number(cfg.topN) : undefined
  );
  ctx.variables[(cfg.outputVar as string) || "ranked"] = res.results;
  helpers.setOutput({ count: res.results.length });
};

export const generate_avatar: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const model = String(cfg.model ?? "");
  if (!model) throw new Error("Falta elegir el modelo de avatar.");
  const text = interpolate(String(cfg.text ?? ""), ctx.variables);
  if (!text.trim()) throw new Error("Falta el texto que dirá el avatar.");
  const { generateAvatar } = await import("@/lib/ai/run");
  const res = await generateAvatar(workspaceId, model, {
    text,
    ...(cfg.avatarId ? { avatarId: String(cfg.avatarId) } : {}),
    ...(cfg.voiceId ? { voiceId: String(cfg.voiceId) } : {}),
    ...(cfg.imageUrl ? { imageUrl: interpolate(String(cfg.imageUrl), ctx.variables) } : {}),
  });
  ctx.variables[(cfg.outputVar as string) || "video"] = res.url;
  helpers.setOutput({ url: res.url });
};

export const generate_music: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const model = String(cfg.model ?? "");
  if (!model) throw new Error("Falta elegir el modelo de música.");
  const prompt = interpolate(String(cfg.prompt ?? ""), ctx.variables);
  const { generateMusic } = await import("@/lib/ai/run");
  const res = await generateMusic(workspaceId, model, prompt);
  ctx.variables[(cfg.outputVar as string) || "musica"] = res.url;
  helpers.setOutput({ url: res.url });
};

export const ocr_extract: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const model = String(cfg.model ?? "");
  if (!model) throw new Error("Falta elegir el modelo de OCR.");
  const documentUrl = interpolate(String(cfg.documentUrl ?? ""), ctx.variables);
  if (!documentUrl.trim()) throw new Error("Falta la URL del documento.");
  const { ocr } = await import("@/lib/ai/run");
  const res = await ocr(workspaceId, model, documentUrl);
  ctx.variables[(cfg.outputVar as string) || "texto"] = res.text;
  helpers.setOutput({ chars: res.text.length });
};

export const embed_text: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const model = String(cfg.model ?? "");
  if (!model) throw new Error("Falta elegir el modelo de embeddings.");
  const text = interpolate(String(cfg.input ?? "{{message}}"), ctx.variables);
  const { embed } = await import("@/lib/ai/run");
  const res = await embed(workspaceId, model, [text]);
  const outputVar = (cfg.outputVar as string) || "vector";
  ctx.variables[outputVar] = res.vectors[0] ?? [];
  helpers.setOutput({ dims: res.vectors[0]?.length ?? 0 });
};

export const llm_prompt: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const model = String(cfg.model ?? "");
  if (!model) throw new Error("Falta elegir el modelo.");
  const prompt = interpolate(String(cfg.prompt ?? ""), ctx.variables);
  if (!prompt.trim()) throw new Error("Falta la instrucción.");
  const system = cfg.system ? interpolate(String(cfg.system), ctx.variables) : "";
  const { runChat } = await import("@/lib/ai/run");
  const res = await runChat({
    workspaceId,
    model,
    systemPrompt: system,
    messages: [{ role: "user", content: prompt }],
  });
  const outputVar = (cfg.outputVar as string) || "texto";
  ctx.variables[outputVar] = res.content;
  helpers.setOutput({ tokensUsed: res.tokensUsed });
};

export const kb_search: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const kbId = cfg.kbId as string | undefined;
  if (!kbId) throw new Error("Falta elegir la base de conocimiento.");
  const query = interpolate((cfg.query as string) ?? "{{message}}", ctx.variables);
  const topK = cfg.topK != null ? Number(cfg.topK) : 5;
  const { searchKnowledgeBase } = await import("@/lib/knowledge-search");
  const results = await searchKnowledgeBase(workspaceId, kbId, query, topK);
  const outputVar = (cfg.outputVar as string) ?? "knowledge";
  ctx.variables[outputVar] = results;
  helpers.setOutput({ count: results.length, topResult: results[0]?.text?.slice(0, 200) });
};
