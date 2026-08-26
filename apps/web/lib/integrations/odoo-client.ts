import "server-only";
import { createHash } from "node:crypto";

/**
 * Odoo JSON-RPC client.
 *
 * Odoo exposes its ORM over two transports: XML-RPC (`/xmlrpc/2/...`) and
 * JSON-RPC (`/jsonrpc`). We speak JSON-RPC so no XML serializer is needed —
 * `fetch` + `JSON.stringify` is the whole client.
 *
 * Two traps this module exists to absorb:
 *
 *  1. **Odoo reports errors with HTTP 200.** A failed call returns a normal
 *     200 whose body carries an `error` object. Code that only checks the
 *     status code reads a failure as a success.
 *  2. **`execute_kw` is positional.** The argument order is
 *     `[db, uid, password, model, method, args, kwargs]`; a swapped pair
 *     fails in ways that do not name the real cause.
 */

export interface OdooCredentials {
  baseUrl: string;
  db: string;
  login: string;
  apiKey: string;
}

/** Odoo's `helpdesk.ticket` priority is a selection of strings, not integers. */
export const TICKET_PRIORITY = {
  low: "0",
  medium: "1",
  high: "2",
  urgent: "3",
} as const;

export type TicketPriority = keyof typeof TICKET_PRIORITY;

/**
 * x2many fields (`tag_ids`, `user_ids`) do not accept a plain array of ids on
 * write — they take command triplets. `(6, 0, ids)` replaces the whole set.
 * Passing bare ids is the single most common Odoo integration bug.
 */
export function x2manyReplace(ids: number[]): [number, number, number[]][] {
  return [[6, 0, ids]];
}

/**
 * Odoo renders `description` and chatter bodies as HTML. Markdown reaches the
 * ticket as literal asterisks, and an unescaped `<` truncates the report at
 * the first angle bracket — which, in a stack trace, is common.
 */
export function htmlFromText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n|\r|\n/g, "<br/>");
}

// ── Transport ───────────────────────────────────────────────────────────────

const RPC_TIMEOUT_MS = 20_000;
let rpcId = 0;

/**
 * uid cache. Keyed by a hash of the full credential set (not just host + db):
 * two workspaces may point at the same Odoo with different API keys, and they
 * must never share a session.
 */
const uidCache = new Map<string, number>();

function credentialKey(c: OdooCredentials): string {
  return createHash("sha256").update([c.baseUrl, c.db, c.login, c.apiKey].join("|")).digest("hex");
}

/** Test seam — the cache is module state and would leak between cases. */
export function __resetOdooAuthCache(): void {
  uidCache.clear();
}

function endpointOf(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/jsonrpc`;
}

interface OdooRpcError {
  message?: string;
  data?: { message?: string; name?: string };
}

function describeRpcError(error: OdooRpcError): string {
  const detail = error.data?.message?.trim();
  const summary = error.message?.trim();
  // `data.message` carries the actual Python exception; `message` is usually
  // the generic "Odoo Server Error".
  if (detail && summary && detail !== summary) return `${summary}: ${detail}`;
  return detail || summary || "Unknown Odoo error";
}

async function rpc(
  baseUrl: string,
  service: string,
  method: string,
  args: unknown[]
): Promise<unknown> {
  const url = endpointOf(baseUrl);
  // Same SSRF guard the HTTP connector uses: a workspace-supplied base URL is
  // untrusted input.
  const { assertPublicUrl } = await import("@/lib/net-guard");
  assertPublicUrl(url);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), RPC_TIMEOUT_MS);
  let text: string;
  let status: number;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service, method, args },
        id: ++rpcId,
      }),
      signal: ac.signal,
    });
    status = res.status;
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  let payload: { result?: unknown; error?: OdooRpcError } | null = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Odoo returned a non-JSON response (HTTP ${status}): ${text.slice(0, 200)}`);
  }

  // Trap 1: the error rides inside a 200.
  if (payload?.error) throw new Error(describeRpcError(payload.error));
  if (status >= 400) throw new Error(`Odoo request failed with HTTP ${status}`);
  return payload?.result;
}

// ── Session ─────────────────────────────────────────────────────────────────

async function authenticate(c: OdooCredentials): Promise<number> {
  const result = await rpc(c.baseUrl, "common", "authenticate", [c.db, c.login, c.apiKey, {}]);
  // Odoo answers a bad credential with `false`, not with an error.
  if (typeof result !== "number" || result <= 0) {
    throw new Error(`Odoo authentication failed for ${c.login} on database "${c.db}"`);
  }
  return result;
}

async function uidFor(c: OdooCredentials): Promise<number> {
  const key = credentialKey(c);
  const cached = uidCache.get(key);
  if (cached !== undefined) return cached;
  const uid = await authenticate(c);
  uidCache.set(key, uid);
  return uid;
}

function credentialsFrom(config: Record<string, string>): OdooCredentials {
  const baseUrl = (config.baseUrl ?? "").trim();
  const db = (config.db ?? "").trim();
  const login = (config.login ?? "").trim();
  const apiKey = (config.apiKey ?? "").trim();
  if (!baseUrl || !db || !login || !apiKey) {
    throw new Error("Odoo needs baseUrl, db, login and apiKey to be configured.");
  }
  return { baseUrl, db, login, apiKey };
}

function isSessionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message.toLowerCase() : "";
  return msg.includes("session expired") || msg.includes("invalid session");
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Call any model method — the same surface `execute_kw` exposes, which is the
 * whole Odoo ORM.
 */
export async function odooExecute(
  config: Record<string, string>,
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {}
): Promise<unknown> {
  const c = credentialsFrom(config);
  const uid = await uidFor(c);
  try {
    // Trap 2: this order is the contract.
    return await rpc(c.baseUrl, "object", "execute_kw", [
      c.db,
      uid,
      c.apiKey,
      model,
      method,
      args,
      kwargs,
    ]);
  } catch (e) {
    // A cached uid can outlive its session. Re-authenticate once before
    // surfacing what would otherwise look like a permissions problem.
    if (isSessionError(e)) {
      uidCache.delete(credentialKey(c));
      const fresh = await uidFor(c);
      return rpc(c.baseUrl, "object", "execute_kw", [
        c.db,
        fresh,
        c.apiKey,
        model,
        method,
        args,
        kwargs,
      ]);
    }
    throw e;
  }
}

/** Verifies both reachability and credentials in one round trip. */
export async function odooAuthenticate(config: Record<string, string>): Promise<number> {
  return authenticate(credentialsFrom(config));
}
