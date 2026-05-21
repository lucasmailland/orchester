#!/usr/bin/env node
/**
 * Orchester MCP — bridge stdio ↔ HTTP.
 *
 * Algunos clientes MCP (Claude Desktop clásico, etc.) sólo hablan stdio con un
 * proceso local. Este bridge expone el MCP server remoto de Orchester como un
 * server stdio: lee JSON-RPC de stdin (framing newline-delimited), lo reenvía
 * al endpoint HTTP /api/mcp con la API key, y escribe la respuesta a stdout.
 *
 * Uso (config del cliente MCP):
 *   {
 *     "mcpServers": {
 *       "orchester": {
 *         "command": "node",
 *         "args": ["/ruta/a/stdio-bridge.mjs"],
 *         "env": {
 *           "ORCHESTER_URL": "https://tu-instancia/api/mcp",
 *           "ORCHESTER_API_KEY": "ok_live_…"
 *         }
 *       }
 *     }
 *   }
 */
import { createInterface } from "node:readline";

const URL_ = process.env.ORCHESTER_URL || "http://localhost:3000/api/mcp";
const KEY = process.env.ORCHESTER_API_KEY || "";

if (!KEY) {
  process.stderr.write("[orchester-mcp] Falta ORCHESTER_API_KEY en el env del server.\n");
  process.exit(1);
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function forward(req) {
  try {
    const r = await fetch(URL_, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify(req),
      // Timeout para que un LLM colgado no congele el bridge (y el cliente).
      signal: AbortSignal.timeout(120_000),
    });
    if (r.status === 202) return null; // notification, sin cuerpo
    const text = await r.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id: req.id ?? null,
      error: { code: -32000, message: `Bridge error: ${e?.message ?? String(e)}` },
    };
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return; // ignorar líneas mal formadas
  }
  const res = await forward(req);
  if (res) send(res);
});

rl.on("close", () => process.exit(0));
process.stderr.write(`[orchester-mcp] bridge listo → ${URL_}\n`);
