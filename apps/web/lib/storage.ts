import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

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
    const r = await fetch(url, {
      method: "PUT",
      headers,
      // Buffer is a Uint8Array; cast to satisfy lib.dom.d.ts BodyInit typing
      body: body as unknown as BodyInit,
    });
    if (!r.ok) {
      throw new Error(`S3 PUT ${r.status}: ${await r.text()}`);
    }
    return { key, contentType, size: body.length };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const url = this.objectUrl(key);
    const headers = await this.sign("GET", url, undefined, {});
    const r = await fetch(url, { method: "GET", headers });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`S3 GET ${r.status}: ${await r.text()}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return { body: buf, contentType: r.headers.get("content-type") ?? "application/octet-stream" };
  }

  async delete(key: string): Promise<void> {
    const url = this.objectUrl(key);
    const headers = await this.sign("DELETE", url, undefined, {});
    const r = await fetch(url, { method: "DELETE", headers });
    if (!r.ok && r.status !== 404) {
      throw new Error(`S3 DELETE ${r.status}: ${await r.text()}`);
    }
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
