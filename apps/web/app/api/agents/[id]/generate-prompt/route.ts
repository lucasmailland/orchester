import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { llmCall, pickAvailableModel } from "@/lib/llm-call";
import { assertWithinSpend } from "@/lib/cost-alerts";

const generatePromptSchema = z.object({
  description: z.string().trim().min(1, "description required"),
  tone: z.enum(["professional", "friendly", "formal", "direct"]).optional(),
  context: z
    .object({
      companyName: z.string().optional(),
      industry: z.string().optional(),
      extraDetails: z.string().optional(),
    })
    .optional(),
});

const META_PROMPT = `You are an expert prompt engineer. Generate THREE distinct system prompt variations for an AI agent.

Each prompt must:
- Be a complete system prompt (not a description of one)
- Define the agent's role, tone, and core behaviors
- Include 1-2 concrete examples or guardrails
- Be 200-600 words

Return ONLY a JSON array of three strings, no markdown, no commentary:
["prompt1...", "prompt2...", "prompt3..."]`;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  await params;
  const parsed = await parseBody(req, generatePromptSchema);
  if (!parsed.ok) return parsed.response;
  const { description, tone, context } = parsed.data;

  const pick = await pickAvailableModel(ctx.workspace.id);
  if (!pick)
    return NextResponse.json({ error: "PROVIDER_NOT_CONFIGURED" }, { status: 401 });

  const userMsg = [
    `Description: ${description.trim()}`,
    tone ? `Desired tone: ${tone}` : "",
    context?.companyName ? `Company: ${context.companyName}` : "",
    context?.industry ? `Industry: ${context.industry}` : "",
    context?.extraDetails ? `Additional context: ${context.extraDetails}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await assertWithinSpend(ctx.workspace.id);
    const r = await llmCall({
      workspaceId: ctx.workspace.id,
      model: pick.model,
      systemPrompt: META_PROMPT,
      messages: [{ role: "user", content: userMsg }],
      temperature: 0.8,
      maxTokens: 3000,
    });
    const cleaned = r.content.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
    let variations: string[] = [];
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) variations = parsed.filter((s) => typeof s === "string");
    } catch {
      variations = r.content.split(/\n\n\n+/).slice(0, 3);
    }
    if (!variations.length) variations = [r.content];
    return NextResponse.json({ variations, model: pick.model });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
