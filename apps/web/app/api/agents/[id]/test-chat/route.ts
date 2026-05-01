import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { llmCall, ProviderNotConfiguredError } from "@/lib/llm-call";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await params;
  const body = await req.json();
  const { messages, systemPrompt, model, temperature, maxTokens } = body as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    systemPrompt: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
  if (!messages?.length || !systemPrompt || !model)
    return NextResponse.json(
      { error: "messages, systemPrompt, model required" },
      { status: 400 }
    );

  try {
    const r = await llmCall({
      workspaceId: ws.workspace.id,
      model,
      systemPrompt,
      messages,
      ...(temperature !== undefined && { temperature }),
      ...(maxTokens !== undefined && { maxTokens }),
    });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError)
      return NextResponse.json(
        { error: "PROVIDER_NOT_CONFIGURED", provider: e.provider },
        { status: 401 }
      );
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
