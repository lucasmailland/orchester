import "server-only";

/**
 * Guard anti-SSRF para URLs/hosts provistos por el usuario (webhooks salientes,
 * connector HTTP, connection strings de Postgres).
 *
 * Bloquea hosts internos obvios: loopback, RFC1918, link-local (incl. el IP de
 * metadata de cloud 169.254.169.254), y .local. No resuelve DNS (no cubre
 * DNS-rebinding), pero corta los vectores directos. Para entornos muy sensibles
 * conviene además resolver el hostname y validar la IP final.
 */

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "metadata.google.internal"]);

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 0) return true;
  return false;
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ""); // unwrap IPv6 brackets
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv6 ULA / link-local / loopback: SÓLO aplicar prefijos a IPv6 literal
  // (contiene ":"). Antes `startsWith("fc"|"fd"|"fe80")` rechazaba hostnames
  // públicos legítimos como `fc.example.com` o `fdsearch.io`.
  if (h === "::1") return true;
  if (h.includes(":") && (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")))
    return true;
  if (isPrivateIpv4(h)) return true;
  return false;
}

/** Lanza si la URL apunta a un host interno o usa un esquema no http(s). */
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
  if (isBlockedHost(url.hostname)) {
    throw new Error("Esa URL apunta a un host interno/privado y esta bloqueada por seguridad.");
  }
  return url;
}

/** Valida el host de un connection string de Postgres. */
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
    throw new Error("La base apunta a un host interno/privado y esta bloqueada por seguridad.");
  }
}
