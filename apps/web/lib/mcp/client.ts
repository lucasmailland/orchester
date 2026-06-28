import "server-only";
import { fetchWithTimeout } from "../http-util";

export interface RemoteServer {
  url: string;
  authHeader?: string | null;
}

export interface RemoteTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MCP_CLIENT_TIMEOUT_MS = 30_000;
let _id = 0;

async function rpc(
  server: RemoteServer,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (server.authHeader) headers["authorization"] = server.authHeader;
  const r = await fetchWithTimeout(
    server.url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++_id,
        method,
        ...(params ? { params } : {}),
      }),
    },
    MCP_CLIENT_TIMEOUT_MS
  );
  if (!r.ok) throw new Error(`MCP ${method} ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(`MCP error: ${j.error.message ?? "unknown"}`);
  return j.result;
}

export async function listRemoteTools(server: RemoteServer): Promise<RemoteTool[]> {
  await rpc(server, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "orchester", version: "1.0.0" },
  });
  const res = (await rpc(server, "tools/list")) as {
    tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  };
  return (res.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description ?? t.name,
    inputSchema: t.inputSchema ?? { type: "object", properties: {} },
  }));
}

export async function callRemoteTool(
  server: RemoteServer,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return rpc(server, "tools/call", { name, arguments: args });
}
