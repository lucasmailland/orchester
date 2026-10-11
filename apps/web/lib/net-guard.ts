import "server-only";
import dns from "node:dns";
import { isIP } from "node:net";
import { Agent } from "undici";

/**
 * Anti-SSRF guard for destinations a user can influence: outgoing webhooks,
 * the HTTP connector, integration base URLs, Postgres connection strings.
 *
 * Two layers:
 *
 * - `assertPublicUrl` / `assertPublicDbHost` check the string synchronously:
 *   scheme, internal names (localhost, *.local, *.internal, and single-label
 *   names such as `postgres` or `mnemosyne-server`, which a container network
 *   resolves to its neighbours) and internal IP literals.
 * - `safeFetch` also checks the address each connection is about to use,
 *   inside the socket's DNS lookup. A public-looking name that resolves to an
 *   internal address (DNS rebinding) fails there, with no window between check
 *   and connect. Redirects are followed by hand and every hop is re-checked.
 *
 * `NET_GUARD_ALLOWED_HOSTS` (comma-separated hostnames or IP literals) lets a
 * deployment reach specific internal services on purpose, e.g. a local Ollama.
 */

const BLOCKED_MESSAGE = "Esa URL apunta a un host interno/privado y esta bloqueada por seguridad.";

export class BlockedDestinationError extends Error {
  constructor(message = BLOCKED_MESSAGE) {
    super(message);
    this.name = "BlockedDestinationError";
  }
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);
const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".localdomain"];

function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function allowedHosts(): Set<string> {
  const raw = process.env["NET_GUARD_ALLOWED_HOSTS"] ?? "";
  return new Set(
    raw
      .split(",")
      .map((h) => normalizeHost(h.trim()))
      .filter(Boolean)
  );
}

function isAllowedHost(host: string): boolean {
  return allowedHosts().has(normalizeHost(host));
}

// ─── Address classification ────────────────────────────────────────────────

function parseIpv4(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return null;
  return octets as [number, number, number, number];
}

function isBlockedIpv4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Expands an IPv6 literal (with optional embedded IPv4 tail) to 8 hextets. */
function parseIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);

  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${(
      (v4[2] << 8) |
      v4[3]
    ).toString(16)}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;

  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const hextets = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return hextets.some(Number.isNaN) ? null : hextets;
}

function embeddedIpv4(h: number[], at: number): [number, number, number, number] {
  return [h[at]! >> 8, h[at]! & 0xff, h[at + 1]! >> 8, h[at + 1]! & 0xff];
}

function isBlockedIpv6(h: number[]): boolean {
  const [h0, h1, h2, h3, h4, h5] = h as [number, number, number, number, number, number];
  const firstFiveZero = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;

  // ::, ::1 and IPv4-compatible ::a.b.c.d
  if (firstFiveZero && h5 === 0) {
    if (h[6] === 0 && (h[7] === 0 || h[7] === 1)) return true;
    return isBlockedIpv4(embeddedIpv4(h, 6));
  }
  if (firstFiveZero && h5 === 0xffff) return isBlockedIpv4(embeddedIpv4(h, 6)); // ::ffff:a.b.c.d
  if (h0 === 0x64 && h1 === 0xff9b) return true; // NAT64 (both /96 and /48)
  if (h0 === 0x2002) return isBlockedIpv4(embeddedIpv4(h, 1)); // 6to4
  if (h0 === 0x2001 && h1 === 0) return true; // Teredo
  if (h0 === 0x2001 && h1 === 0xdb8) return true; // documentation
  if (h0 === 0x100 && h1 === 0 && h2 === 0 && h3 === 0) return true; // discard
  if ((h0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((h0 & 0xffc0) === 0xfe80) return true; // link-local
  if ((h0 & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((h0 & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/**
 * True for any IP literal outside the public unicast space: loopback, private,
 * link-local, CGNAT, multicast, reserved, and IPv6 forms that embed one of
 * those (mapped, compatible, NAT64, 6to4). Unparseable input counts as blocked.
 */
export function isBlockedAddress(ip: string): boolean {
  const host = normalizeHost(ip);
  const v4 = parseIpv4(host);
  if (v4) return isBlockedIpv4(v4);
  const v6 = parseIpv6(host);
  if (v6) return isBlockedIpv6(v6);
  return true;
}

function isBlockedHost(rawHost: string): boolean {
  const host = normalizeHost(rawHost);
  if (!host) return true;
  if (isAllowedHost(host)) return false;
  if (isIP(host)) return isBlockedAddress(host);
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // A public name has a dot. A single label is resolved by the container or
  // search domain: the database, the cache, the memory server.
  if (!host.includes(".")) return true;
  return false;
}

// ─── String checks ─────────────────────────────────────────────────────────

/** Throws if the URL is not http(s) or names an internal host. */
export function assertPublicUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL invalida");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Solo se permiten URLs http(s)");
  }
  if (isBlockedHost(url.hostname)) throw new BlockedDestinationError();
  return url;
}

/** Validates the host of a Postgres connection string. */
export function assertPublicDbHost(connectionString: string): void {
  let host = "";
  try {
    const u = new URL(connectionString.replace(/^postgres(ql)?:\/\//, "https://"));
    host = u.hostname;
  } catch {
    throw new Error("Connection string invalida");
  }
  if (!host) throw new Error("No se pudo extraer el host de la connection string");
  if (isBlockedHost(host)) {
    throw new BlockedDestinationError(
      "La base apunta a un host interno/privado y esta bloqueada por seguridad."
    );
  }
}

// ─── Connection-time check ─────────────────────────────────────────────────

type ResolvedAddress = { address: string; family: number };
type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const systemResolver: Resolver = (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

let resolverOverride: Resolver | undefined;

/** Test seam: replace DNS resolution. Pass undefined to restore. */
export function _setResolverForTests(resolver: Resolver | undefined): void {
  resolverOverride = resolver;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | ResolvedAddress[],
  family?: number
) => void;

/**
 * `lookup` for the socket: resolves, refuses if ANY address is internal, then
 * hands the addresses to the connection. IP literals skip lookup entirely,
 * which is why every URL also goes through `assertPublicUrl` first.
 */
function guardedLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback) {
  (resolverOverride ?? systemResolver)(hostname).then(
    (addresses) => {
      if (!isAllowedHost(hostname)) {
        if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
          callback(new BlockedDestinationError() as NodeJS.ErrnoException, "", 0);
          return;
        }
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    },
    (err: NodeJS.ErrnoException) => callback(err, "", 0)
  );
}

const guardedAgent = new Agent({ connect: { lookup: guardedLookup as never } });

/** undici wraps connect errors in "fetch failed"; surface ours if it is in the chain. */
function unwrapBlocked(err: unknown): unknown {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof BlockedDestinationError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return err;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_DROPPED_HEADERS = ["authorization", "cookie", "proxy-authorization"];

export interface SafeFetchInit extends RequestInit {
  /** Redirects to follow before giving up. Default 5. */
  maxRedirects?: number;
  /**
   * Whole-request timeout in ms, redirects and body included. Default 30s.
   * `null` when the caller enforces its own deadline through `signal`.
   */
  timeoutMs?: number | null;
}

/**
 * `fetch` for user-influenced destinations. Checks the URL, every address the
 * connection resolves to, and every redirect hop. Throws
 * `BlockedDestinationError` when any of them is internal.
 */
export async function safeFetch(rawUrl: string, init: SafeFetchInit = {}): Promise<Response> {
  const { maxRedirects = 5, timeoutMs = 30_000, ...rest } = init;
  let url = assertPublicUrl(rawUrl);
  let method = (rest.method ?? "GET").toUpperCase();
  let body = rest.body;
  const headers = new Headers(rest.headers);
  const signals = [rest.signal, timeoutMs === null ? null : AbortSignal.timeout(timeoutMs)].filter(
    (s): s is AbortSignal => Boolean(s)
  );
  const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;

  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      // Global fetch with our dispatcher (checked against Node 22 and 24), so
      // tests that stub globalThis.fetch keep intercepting these calls.
      res = await fetch(url, {
        ...rest,
        method,
        body,
        headers,
        signal,
        redirect: "manual",
        dispatcher: guardedAgent,
      } as RequestInit);
    } catch (err) {
      throw unwrapBlocked(err);
    }

    const location = res.headers.get("location");
    if (!REDIRECT_STATUSES.has(res.status) || !location) return res;
    await res.body?.cancel();
    if (hop >= maxRedirects) throw new Error(`Too many redirects (more than ${maxRedirects})`);

    const next = assertPublicUrl(new URL(location, url).toString());
    const downgradesToGet =
      res.status === 303 ||
      ((res.status === 301 || res.status === 302) && method !== "GET" && method !== "HEAD");
    if (downgradesToGet) {
      method = "GET";
      body = null;
      headers.delete("content-type");
      headers.delete("content-length");
    }
    if (next.origin !== url.origin) {
      for (const h of CROSS_ORIGIN_DROPPED_HEADERS) headers.delete(h);
    }
    url = next;
  }
}

export class ResponseTooLargeError extends Error {
  constructor(public maxBytes: number) {
    super(`Response is larger than ${maxBytes} bytes`);
    this.name = "ResponseTooLargeError";
  }
}

/**
 * Reads a response body, stopping as soon as it passes `maxBytes`. For bodies
 * from user-chosen URLs, where the far end decides how much we buffer.
 */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new ResponseTooLargeError(maxBytes);
  }
  if (!res.body) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ResponseTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
