import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fetchWithTimeout } from "./http-util";
import { safeLogError } from "./safe-log";

const S3_TIMEOUT_MS = 30_000;

/**
 * Object storage abstraction.
 * Drivers:
 *   - "local"  → filesystem (default; perfect for single-node self-host)
 *   - "s3"     → S3-compatible (MinIO en docker-compose, AWS S3, R2, Backblaze B2)
 *
 * Selección por env:
 *   STORAGE_DRIVER=local     → STORAGE_LOCAL_PATH=./uploads
 *   STORAGE_DRIVER=s3        → S3_ENDPOINT, S3_BUCKET, S3_REGION,
 *                              S3_ACCESS_KEY, S3_SECRET_KEY, S3_FORCE_PATH_STYLE
 *
 * NOTA: El driver S3 usa fetch + AWS SigV4 firmado a mano para evitar la
 * dependencia de @aws-sdk/* (ahorra ~3MB en el bundle del worker).
 */

export interface StorageObject {
  key: string;
  contentType: string;
  size: number;
}

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<StorageObject>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /**
   * Borra TODOS los objetos cuyo key empieza con `prefix`. Devuelve la cantidad
   * de objetos borrados. Es resiliente: errores en objetos individuales se
   * loguean (safeLogError) pero no abortan el barrido completo.
   */
  deleteByPrefix(prefix: string): Promise<number>;
  url(key: string): string;
}

function driver(): "local" | "s3" {
  const d = (process.env["STORAGE_DRIVER"] ?? "local").toLowerCase();
  return d === "s3" ? "s3" : "local";
}

// ───────────────────────────── LOCAL ─────────────────────────────

class LocalStorage implements Storage {
  constructor(private root: string) {}

  private full(key: string): string {
    // Bloquea path traversal: keys deben ser relativos sin ".."
    if (key.includes("..") || path.isAbsolute(key)) {
      throw new Error("Invalid key: path traversal");
    }
    return path.join(this.root, key);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StorageObject> {
    const full = this.full(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
    // Sidecar: guardamos el content-type al lado para recuperar al GET
    await writeFile(`${full}.meta`, JSON.stringify({ contentType }));
    return { key, contentType, size: body.length };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const full = this.full(key);
    if (!existsSync(full)) return null;
    const body = await readFile(full);
    let contentType = "application/octet-stream";
    if (existsSync(`${full}.meta`)) {
      try {
        contentType = JSON.parse(await readFile(`${full}.meta`, "utf8")).contentType ?? contentType;
      } catch {}
    }
    return { body, contentType };
  }

  async delete(key: string): Promise<void> {
    const full = this.full(key);
    if (existsSync(full)) await unlink(full);
    if (existsSync(`${full}.meta`)) await unlink(`${full}.meta`);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    // Guard path-traversal: el prefix debe resolver DENTRO del root.
    if (prefix.includes("..") || path.isAbsolute(prefix)) {
      safeLogError("[storage] deleteByPrefix rejected (traversal):", prefix);
      return 0;
    }
    const target = path.resolve(this.root, prefix);
    const rootResolved = path.resolve(this.root);
    // target debe ser el root mismo o estar contenido en él.
    if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
      safeLogError("[storage] deleteByPrefix escaped root:", prefix);
      return 0;
    }

    // El prefix puede apuntar a un directorio (ej "ws123/") o a un sub-path
    // parcial. Recolectamos todos los archivos bajo `target` (si es dir) o
    // archivos hermanos cuyo nombre arranca con el basename (si es path parcial).
    let count = 0;

    const countFiles = async (dir: string): Promise<number> => {
      let n = 0;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return 0;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          n += await countFiles(p);
        } else if (!e.name.endsWith(".meta")) {
          // sólo contamos objetos reales, no los sidecars .meta
          n += 1;
        }
      }
      return n;
    };

    try {
      if (existsSync(target)) {
        // Caso típico: prefix es un directorio. Contamos y borramos recursivo.
        count = await countFiles(target);
        await rm(target, { recursive: true, force: true });
      } else {
        // Prefix parcial: borra archivos del directorio padre cuyo basename
        // empiece con el último segmento del prefix.
        const parent = path.dirname(target);
        const base = path.basename(target);
        let entries;
        try {
          entries = await readdir(parent, { withFileTypes: true });
        } catch {
          return 0;
        }
        for (const e of entries) {
          if (!e.isFile() || !e.name.startsWith(base)) continue;
          const p = path.join(parent, e.name);
          try {
            await unlink(p);
            if (!e.name.endsWith(".meta")) count += 1;
          } catch (err) {
            safeLogError("[storage] deleteByPrefix unlink failed:", err);
          }
        }
      }
    } catch (err) {
      safeLogError("[storage] deleteByPrefix failed:", err);
    }
    return count;
  }

  url(key: string): string {
    // Servimos via Next.js route /api/files/[...path] (tiene auth gating)
    return `/api/files/${encodeURIComponent(key)}`;
  }
}

// ───────────────────────────── S3 ────────────────────────────────

class S3Storage implements Storage {
  private endpoint: string;
  private region: string;
  private bucket: string;
  private accessKey: string;
  private secretKey: string;
  private forcePathStyle: boolean;

  constructor() {
    this.endpoint = (process.env["S3_ENDPOINT"] ?? "").replace(/\/$/, "");
    this.region = process.env["S3_REGION"] ?? "us-east-1";
    this.bucket = process.env["S3_BUCKET"] ?? "";
    this.accessKey = process.env["S3_ACCESS_KEY"] ?? "";
    this.secretKey = process.env["S3_SECRET_KEY"] ?? "";
    this.forcePathStyle = (process.env["S3_FORCE_PATH_STYLE"] ?? "false") === "true";

    if (!this.endpoint || !this.bucket || !this.accessKey || !this.secretKey) {
      throw new Error(
        "S3 storage misconfigured: set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY"
      );
    }
  }

  private objectUrl(key: string): string {
    if (this.forcePathStyle) {
      return `${this.endpoint}/${this.bucket}/${encodeURI(key)}`;
    }
    const u = new URL(this.endpoint);
    u.host = `${this.bucket}.${u.host}`;
    return `${u.toString().replace(/\/$/, "")}/${encodeURI(key)}`;
  }

  /**
   * AWS SigV4 firmado a mano.
   * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
   */
  private async sign(
    method: string,
    url: string,
    body: Buffer | undefined,
    headers: Record<string, string>
  ): Promise<Record<string, string>> {
    const u = new URL(url);
    const now = new Date();
    const amzDate = now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "")
      .replace("Z", "Z");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256")
      .update(body ?? Buffer.alloc(0))
      .digest("hex");

    const allHeaders: Record<string, string> = {
      ...headers,
      host: u.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };

    const sortedHeaderKeys = Object.keys(allHeaders)
      .map((k) => k.toLowerCase())
      .sort();
    const canonicalHeaders =
      sortedHeaderKeys.map((k) => `${k}:${allHeaders[k]?.trim() ?? ""}`).join("\n") + "\n";
    const signedHeaders = sortedHeaderKeys.join(";");

    const canonicalRequest = [
      method,
      u.pathname,
      u.searchParams.toString(),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const { createHmac } = await import("node:crypto");
    const kDate = createHmac("sha256", `AWS4${this.secretKey}`).update(dateStamp).digest();
    const kRegion = createHmac("sha256", kDate).update(this.region).digest();
    const kService = createHmac("sha256", kRegion).update("s3").digest();
    const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    return {
      ...allHeaders,
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StorageObject> {
    const url = this.objectUrl(key);
    const headers = await this.sign("PUT", url, body, {
      "content-type": contentType,
      "content-length": String(body.length),
    });
    const r = await fetchWithTimeout(url, {
      method: "PUT",
      headers,
      // Buffer is a Uint8Array; cast to satisfy lib.dom.d.ts BodyInit typing
      body: body as unknown as BodyInit,
    }, S3_TIMEOUT_MS);
    if (!r.ok) {
      throw new Error(`S3 PUT ${r.status}: ${await r.text()}`);
    }
    return { key, contentType, size: body.length };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const url = this.objectUrl(key);
    const headers = await this.sign("GET", url, undefined, {});
    const r = await fetchWithTimeout(url, { method: "GET", headers }, S3_TIMEOUT_MS);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`S3 GET ${r.status}: ${await r.text()}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return { body: buf, contentType: r.headers.get("content-type") ?? "application/octet-stream" };
  }

  async delete(key: string): Promise<void> {
    const url = this.objectUrl(key);
    const headers = await this.sign("DELETE", url, undefined, {});
    const r = await fetchWithTimeout(url, { method: "DELETE", headers }, S3_TIMEOUT_MS);
    if (!r.ok && r.status !== 404) {
      throw new Error(`S3 DELETE ${r.status}: ${await r.text()}`);
    }
  }

  /** URL del bucket (sin key) para operaciones a nivel bucket (list / batch delete). */
  private bucketUrl(): string {
    if (this.forcePathStyle) {
      return `${this.endpoint}/${this.bucket}`;
    }
    const u = new URL(this.endpoint);
    u.host = `${this.bucket}.${u.host}`;
    return u.toString().replace(/\/$/, "");
  }

  /** Extrae los <Key>…</Key> de una respuesta XML de ListObjectsV2. */
  private parseKeys(xml: string): string[] {
    const keys: string[] = [];
    const re = /<Key>([^<]*)<\/Key>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      // Des-escapa las entidades XML básicas que S3 puede emitir.
      const raw = (m[1] ?? "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      if (raw) keys.push(raw);
    }
    return keys;
  }

  private parseContinuationToken(xml: string): string | null {
    const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
    if (!truncated) return null;
    const m = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    return m?.[1] ?? null;
  }

  /** Lista todas las keys bajo `prefix`, paginando con ListObjectsV2. */
  private async listKeys(prefix: string): Promise<string[]> {
    const all: string[] = [];
    let token: string | null = null;
    do {
      const u = new URL(this.bucketUrl());
      u.searchParams.set("list-type", "2");
      u.searchParams.set("prefix", prefix);
      u.searchParams.set("max-keys", "1000");
      if (token) u.searchParams.set("continuation-token", token);
      const url = u.toString();
      const headers = await this.sign("GET", url, undefined, {});
      const r = await fetchWithTimeout(url, { method: "GET", headers }, S3_TIMEOUT_MS);
      if (!r.ok) {
        safeLogError(`[storage] S3 ListObjectsV2 ${r.status}:`, await r.text());
        break;
      }
      const xml = await r.text();
      all.push(...this.parseKeys(xml));
      token = this.parseContinuationToken(xml);
    } while (token);
    return all;
  }

  /** Borra un lote de keys con POST ?delete (DeleteObjects). Devuelve cuántas pidió borrar. */
  private async deleteBatch(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const objectsXml = keys
      .map(
        (k) =>
          `<Object><Key>${k
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")}</Key></Object>`
      )
      .join("");
    const body = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${objectsXml}</Delete>`,
      "utf8"
    );
    const md5 = createHash("md5").update(body).digest("base64");
    const url = `${this.bucketUrl()}/?delete`;
    const headers = await this.sign("POST", url, body, {
      "content-type": "application/xml",
      "content-md5": md5,
      "content-length": String(body.length),
    });
    const r = await fetchWithTimeout(
      url,
      { method: "POST", headers, body: body as unknown as BodyInit },
      S3_TIMEOUT_MS
    );
    if (!r.ok) {
      safeLogError(`[storage] S3 DeleteObjects ${r.status}:`, await r.text());
      return 0;
    }
    return keys.length;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let count = 0;
    try {
      const keys = await this.listKeys(prefix);
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        count += await this.deleteBatch(batch);
      }
    } catch (err) {
      safeLogError("[storage] S3 deleteByPrefix failed:", err);
    }
    return count;
  }

  url(key: string): string {
    return this.objectUrl(key);
  }
}

// ───────────────────────────── Singleton ─────────────────────────

let _storage: Storage | null = null;

export function getStorage(): Storage {
  if (_storage) return _storage;
  if (driver() === "s3") {
    _storage = new S3Storage();
  } else {
    const root = path.resolve(process.env["STORAGE_LOCAL_PATH"] ?? "./uploads");
    _storage = new LocalStorage(root);
  }
  return _storage;
}

/** Helper: genera una key estable y única para un workspace. */
export function makeKey(workspaceId: string, prefix: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${workspaceId}/${prefix}/${randomUUID()}-${safe}`;
}
