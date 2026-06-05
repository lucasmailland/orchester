import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-auth/key";
import { rateLimit } from "@/lib/rate-limit";
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  listMcpTools,
  callMcpTool,
  type McpAuth,
} from "@/lib/mcp/server";

/**
 * Orchester MCP server — Streamable HTTP transport.
 *
 * POST /api/mcp  (JSON-RPC 2.0)
 *   Auth: Authorization: Bearer ok_live_…  (API key del workspace)
 *   Métodos: initialize, notifications/initialized, tools/list, tools/call, ping
 *
 * Conectalo desde cualquier cliente MCP (Claude Desktop, Gemini, Cursor):
 *   URL: https://tu-instancia/api/mcp
 *   Header: Authorization: Bearer <API key>
 *
 * Devolvemos application/json (single JSON-RPC response), que es lo que el
 * Streamable HTTP transport acepta para respuestas no-streaming. Soportamos
 * batches (array de requests). Las notifications (sin id) no devuelven cuerpo.
 */

interface JsonRpcReq {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}
function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

/**
 * v1.1 — #28: anti-pattern guidance for the connecting MCP client.
 * Tool calls cost real tokens for the client AND server compute, so we
 * steer clients away from list-then-loop usage that explodes on large
 * workspaces. Kept under ~400 tokens — every connect pays for this
 * once. Newlines are `\n` so the JSON-RPC serialization stays clean.
 */
const MCP_INSTRUCTIONS = [
  "Orchester MCP: manage AI agents, conversations, knowledge (RAG), flows, and employees in the workspace. Start with list_agents or list_flows.",
  "",
  "Usage guidance (avoid the list+loop anti-pattern — 5–10 targeted calls beat 50 speculative ones, typically a 10× cost ratio):",
  "- For knowledge retrieval, call `search_knowledge` with a natural-language query. If you know the kbId, pass it; otherwise call once against the most likely kb. Do NOT iterate `list_knowledge_bases` and re-issue `search_knowledge` against each one.",
  "- When inspecting conversations, read what you need from `list_conversations` (it already returns summary fields) before issuing per-id `get_conversation`. Only fetch full conversations you actually intend to read.",
  "- Keep batches small and queries specific. Tool calls cost tokens on your side and compute on ours.",
  "- Prefer one well-targeted call to N speculative ones; ask the user before fanning out.",
].join("\n");

async function handleOne(req: JsonRpcReq, auth: McpAuth): Promise<object | null> {
  switch (req.method) {
    case "initialize":
      return rpcResult(req.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: MCP_INSTRUCTIONS,
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notification → sin respuesta
    case "ping":
      return rpcResult(req.id, {});
    case "tools/list":
      return rpcResult(req.id, { tools: listMcpTools() });
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const args = (req.params?.arguments as Record<string, unknown>) ?? {};
      if (!name) return rpcError(req.id, -32602, "params.name required");
      const result = await callMcpTool(name, args, auth);
      return rpcResult(req.id, result);
    }
    default:
      return rpcError(req.id, -32601, `Method not supported: ${req.method}`);
  }
}

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json(
      rpcError(null, -32000, "API key missing or invalid (Authorization: Bearer ok_live_…)"),
      { status: 401 }
    );
  }

  // Rate-limit por key (no sólo por workspace): una key rogue no agota el cupo
  // de las demás y el abuso es atribuible.
  const rl = await rateLimit(`mcp:${auth.workspaceId}:${auth.keyId}`, {
    capacity: 120,
    refillPerSec: 2,
  });
  if (!rl.ok) {
    return NextResponse.json(rpcError(null, -32000, "Rate limited"), {
      status: 429,
      headers: { "retry-after": String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)) },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Invalid JSON"), { status: 400 });
  }

  // Batch o request único. Cap de batch para evitar amplificación (un solo
  // token de rate-limit no debe habilitar N llamadas pesadas).
  const isBatch = Array.isArray(body);
  if (isBatch && (body as unknown[]).length > 20) {
    return NextResponse.json(rpcError(null, -32600, "Batch too large (max 20)"), {
      status: 400,
    });
  }
  const reqs = (isBatch ? body : [body]) as JsonRpcReq[];
  const responses: object[] = [];
  for (const r of reqs) {
    if (!r || r.jsonrpc !== "2.0" || typeof r.method !== "string") {
      responses.push(rpcError(r?.id ?? null, -32600, "Invalid JSON-RPC request"));
      continue;
    }
    const res = await handleOne(r, auth);
    if (res) responses.push(res);
  }

  // Si todo eran notifications, 202 sin cuerpo.
  if (responses.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(isBatch ? responses : responses[0]);
}

/** Algunos clients hacen GET para abrir un stream SSE; respondemos 405 (usamos POST-only). */
export async function GET() {
  return NextResponse.json(
    rpcError(
      null,
      -32000,
      "Use POST with JSON-RPC. This MCP server is POST-only (Streamable HTTP)."
    ),
    { status: 405 }
  );
}
