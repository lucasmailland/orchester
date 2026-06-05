// apps/web/lib/gdpr/storage.ts
//
// Storage adapter for GDPR export artefacts.
//
// Selection is env-driven (`STORAGE_BACKEND`):
//   - `s3`         → real S3 + presigned GET URL (production cloud)
//   - `filesystem` → write to `GDPR_EXPORT_DIR` (self-host / dev)
//
// We keep the adapter init lazy + memoized so the heavy `@aws-sdk/*`
// imports stay out of the bundle when the deployment doesn't use S3.
// The `getAdapter()` cache also makes the per-request hot path a single
// property read.
//
// Signed URLs are valid 7 days. That window matches the GDPR data
// portability SLA we promise in `/legal/privacy` and lets the email
// notification land + the user click the link without us needing a
// re-issue endpoint.
import "server-only";

export interface StorageAdapter {
  /**
   * Upload a zipped export artefact and return a time-limited signed
   * URL the worker can email to the requester.
   *
   * `payload` accepts either a Buffer (current path — the in-memory
   * zip builder still holds everything until finalize) or a
   * NodeJS.ReadableStream (future streaming path). Adapters MUST
   * support both forms transparently.
   */
  upload(
    key: string,
    payload: NodeJS.ReadableStream | Buffer
  ): Promise<{ signedUrl: string; expiresAt: Date }>;

  /**
   * Regenerate a fresh signed download URL for an already-uploaded
   * artefact identified by `key`. Used by the polling route so the
   * URL is never persisted plain in the DB — every poll computes a
   * new one with a fresh expiry. Implementations MUST NOT mutate the
   * artefact.
   */
  regenerateSignedUrl(key: string): Promise<{ signedUrl: string; expiresAt: Date }>;
}

const SIGNED_URL_TTL_DAYS = 7;
const SIGNED_URL_TTL_MS = SIGNED_URL_TTL_DAYS * 24 * 60 * 60 * 1000;
const SIGNED_URL_TTL_SECS = SIGNED_URL_TTL_DAYS * 24 * 60 * 60;

/**
 * S3 adapter. Pulls `@aws-sdk/client-s3` + presigner lazily so the dep
 * isn't required at module-load time — deployments using the
 * filesystem backend never resolve these imports. The two imports are
 * also wrapped in try/catch so a missing dep raises a clear error
 * with the env var the operator needs to flip, not an opaque
 * `Cannot find module` from the resolver.
 */
class S3Adapter implements StorageAdapter {
  async upload(
    key: string,
    payload: NodeJS.ReadableStream | Buffer
  ): Promise<{ signedUrl: string; expiresAt: Date }> {
    const { S3Client } = await loadS3Client();
    const { Upload } = await loadS3LibStorage();
    const bucket = requireS3Bucket();
    const region = process.env["AWS_REGION"] ?? "us-east-1";
    const s3 = new S3Client({ region });

    // Phase F.5 (2026-05-26): true streaming via multipart Upload.
    // Accepts Buffer or ReadableStream transparently; multi-GB
    // archives no longer buffer into memory. On source-stream error
    // (e.g. archiver size-guard abort), Upload aborts the multipart
    // via `AbortMultipartUpload` so we don't leak storage cost.
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: bucket,
        Key: key,
        // lib-storage's Upload accepts Node.js Readable streams at
        // runtime, but its type narrows to
        // `StreamingBlobPayloadInputTypes` (a more restrictive
        // intersection). Our payload is `NodeJS.ReadableStream |
        // Buffer`; at runtime archiver always passes a real Node
        // Readable so the SDK is happy. Cast through unknown to
        // assert the structural compatibility we've verified.
        Body: payload as unknown as Buffer,
        ContentType: "application/zip",
        // SSE-S3 defence in depth; bucket policy should ALSO enforce.
        ServerSideEncryption: "AES256",
      },
    });
    await upload.done();

    return this.regenerateSignedUrl(key);
  }

  async regenerateSignedUrl(key: string): Promise<{ signedUrl: string; expiresAt: Date }> {
    const { S3Client, GetObjectCommand } = await loadS3Client();
    const { getSignedUrl } = await loadS3Presigner();
    const bucket = requireS3Bucket();
    const region = process.env["AWS_REGION"] ?? "us-east-1";
    const s3 = new S3Client({ region });
    const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: SIGNED_URL_TTL_SECS,
    });
    return {
      signedUrl,
      expiresAt: new Date(Date.now() + SIGNED_URL_TTL_MS),
    };
  }
}

async function loadS3Client() {
  const clientMod = await import("@aws-sdk/client-s3").catch(() => null);
  if (!clientMod) {
    throw new Error(
      "S3 adapter requires @aws-sdk/client-s3 — install it or set STORAGE_BACKEND=filesystem"
    );
  }
  return clientMod;
}

async function loadS3Presigner() {
  const signerMod = await import("@aws-sdk/s3-request-presigner").catch(() => null);
  if (!signerMod) {
    throw new Error(
      "S3 adapter requires @aws-sdk/s3-request-presigner — install it or set STORAGE_BACKEND=filesystem"
    );
  }
  return signerMod;
}

async function loadS3LibStorage() {
  const libMod = await import("@aws-sdk/lib-storage").catch(() => null);
  if (!libMod) {
    throw new Error(
      "S3 streaming upload requires @aws-sdk/lib-storage — install it or set STORAGE_BACKEND=filesystem"
    );
  }
  return libMod;
}

function requireS3Bucket(): string {
  const bucket = process.env["GDPR_EXPORT_BUCKET"];
  if (!bucket) {
    throw new Error("GDPR_EXPORT_BUCKET env var is required when STORAGE_BACKEND=s3");
  }
  return bucket;
}

/**
 * Filesystem adapter. Writes the zip to `GDPR_EXPORT_DIR` (defaults to
 * `/tmp/orchester-exports`) and returns an HTTP URL pointing at
 * `/api/exports/[token]`. The token is an HMAC-signed envelope of the
 * storage key + expiry, so the download route can verify the link is
 * valid without DB lookup AND so a leaked URL stops working at expiry.
 *
 * The local file path is deterministic per (workspaceId, jobId) so
 * retries overwrite cleanly instead of leaking orphan files.
 */
class FilesystemAdapter implements StorageAdapter {
  async upload(
    key: string,
    payload: NodeJS.ReadableStream | Buffer
  ): Promise<{ signedUrl: string; expiresAt: Date }> {
    const { writeFile, mkdir, unlink } = await import("node:fs/promises");
    const { createWriteStream } = await import("node:fs");
    const { pipeline } = await import("node:stream/promises");
    const { Readable } = await import("node:stream");
    const path = await import("node:path");

    const dir = process.env["GDPR_EXPORT_DIR"] ?? "/tmp/orchester-exports";
    await mkdir(dir, { recursive: true });

    // Flatten the key to a safe filename — keys look like
    // `<workspaceId>/<jobId>.zip` and we don't want to mkdir nested
    // workspace dirs (one less surface for path traversal).
    const filePath = path.join(dir, key.replace(/\//g, "_"));

    if (Buffer.isBuffer(payload)) {
      // Small / buffered uploads stay on the simple atomic-write path.
      await writeFile(filePath, payload);
    } else {
      // Phase F.5 (2026-05-26): true streaming. Pipe the archiver
      // straight into the on-disk write stream so we never hold the
      // full archive resident. On source error (size-guard abort),
      // `pipeline` rejects and we unlink the partial file so we don't
      // leak orphan multi-GB junk under GDPR_EXPORT_DIR.
      const sink = createWriteStream(filePath);
      try {
        // Cast: archiver and any other Node stream that quacks as
        // ReadableStream is acceptable. `pipeline` accepts both
        // Readable subclasses and async iterables, but we Normalise
        // here so the implementation surface is one code path.
        const source =
          typeof (payload as { pipe?: unknown }).pipe === "function"
            ? (payload as InstanceType<typeof Readable>)
            : Readable.from(payload as AsyncIterable<Buffer>);
        await pipeline(source, sink);
      } catch (err) {
        // Best-effort cleanup; ignore "no such file" if the write
        // never opened.
        try {
          await unlink(filePath);
        } catch {
          // ignore
        }
        throw err;
      }
    }

    return this.regenerateSignedUrl(key);
  }

  async regenerateSignedUrl(key: string): Promise<{ signedUrl: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_MS);
    const { buildExportDownloadUrl } = await import("./signed-url");
    const signedUrl = await buildExportDownloadUrl(key, expiresAt);
    return { signedUrl, expiresAt };
  }
}

// `streamToBuffer` was the pre-F.5 fallback used by both adapters
// when the export job buffered the whole archive into memory. With
// the streaming pipeline the helper is no longer reachable from any
// production path. Left out of the module entirely; revive from git
// history if a future Buffer-only adapter needs it.

let adapter: StorageAdapter | null = null;

function getAdapter(): StorageAdapter {
  if (adapter) return adapter;
  const backend = process.env["STORAGE_BACKEND"] ?? "filesystem";
  adapter = backend === "s3" ? new S3Adapter() : new FilesystemAdapter();
  return adapter;
}

/**
 * Reset the memoized adapter. Test-only — production callers go
 * through `uploadZip` which lazily constructs the adapter once. Tests
 * use this to flip `STORAGE_BACKEND` between cases.
 */
export function __resetStorageAdapterForTests(): void {
  adapter = null;
}

/**
 * Upload a zipped export to the configured storage backend and return
 * a time-limited signed URL the worker can email to the requester.
 */
export async function uploadZip(
  key: string,
  payload: NodeJS.ReadableStream | Buffer
): Promise<{ signedUrl: string; expiresAt: Date }> {
  return getAdapter().upload(key, payload);
}

/**
 * Regenerate a fresh signed download URL for a previously-uploaded
 * artefact. The polling route calls this per request so the URL is
 * never persisted plain in the DB — a leaked job row gives an
 * attacker a storageKey, not a working download link.
 */
export async function regenerateSignedUrl(
  key: string
): Promise<{ signedUrl: string; expiresAt: Date }> {
  return getAdapter().regenerateSignedUrl(key);
}
