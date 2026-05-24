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
    const clientMod = await import("@aws-sdk/client-s3").catch(() => null);
    const signerMod = await import("@aws-sdk/s3-request-presigner").catch(() => null);
    if (!clientMod || !signerMod) {
      throw new Error(
        "S3 adapter requires @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner — install them or set STORAGE_BACKEND=filesystem"
      );
    }
    const { S3Client, PutObjectCommand, GetObjectCommand } = clientMod;
    const { getSignedUrl } = signerMod;

    const region = process.env["AWS_REGION"] ?? "us-east-1";
    const bucket = process.env["GDPR_EXPORT_BUCKET"];
    if (!bucket) {
      throw new Error("GDPR_EXPORT_BUCKET env var is required when STORAGE_BACKEND=s3");
    }

    const s3 = new S3Client({ region });
    const body = Buffer.isBuffer(payload) ? payload : await streamToBuffer(payload);

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "application/zip",
        // Defense in depth: encrypt at rest with SSE-S3. Bucket policy
        // should ALSO enforce this; we set it here so we don't depend
        // on policy correctness for crypto.
        ServerSideEncryption: "AES256",
      })
    );

    const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: SIGNED_URL_TTL_SECS,
    });

    return {
      signedUrl,
      expiresAt: new Date(Date.now() + SIGNED_URL_TTL_MS),
    };
  }
}

/**
 * Filesystem adapter. Writes the zip to `GDPR_EXPORT_DIR` (defaults to
 * `/tmp/orchester-exports`) and returns a `file://` URL. Self-host
 * deployments that want HTTP downloads should front this with a tiny
 * `/api/exports/[token]` route handler that HMAC-validates the token
 * — that route lives in the UI bundle that follows this one.
 *
 * The local file path is deterministic per (workspaceId, jobId) so
 * retries overwrite cleanly instead of leaking orphan files.
 */
class FilesystemAdapter implements StorageAdapter {
  async upload(
    key: string,
    payload: NodeJS.ReadableStream | Buffer
  ): Promise<{ signedUrl: string; expiresAt: Date }> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");

    const dir = process.env["GDPR_EXPORT_DIR"] ?? "/tmp/orchester-exports";
    await mkdir(dir, { recursive: true });

    // Flatten the key to a safe filename — keys look like
    // `<workspaceId>/<jobId>.zip` and we don't want to mkdir nested
    // workspace dirs (one less surface for path traversal).
    const filePath = path.join(dir, key.replace(/\//g, "_"));
    const body = Buffer.isBuffer(payload) ? payload : await streamToBuffer(payload);
    await writeFile(filePath, body);

    return {
      // file:// URL is honest about what this is — production deploys
      // should never see this branch. The /api/exports/[token] route
      // can wrap this with an HMAC-signed download URL when needed.
      signedUrl: `file://${filePath}`,
      expiresAt: new Date(Date.now() + SIGNED_URL_TTL_MS),
    };
  }
}

async function streamToBuffer(s: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s) {
    chunks.push(typeof c === "string" ? Buffer.from(c) : (c as Buffer));
  }
  return Buffer.concat(chunks);
}

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
