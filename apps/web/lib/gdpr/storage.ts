// apps/web/lib/gdpr/storage.ts
//
// Storage adapter for GDPR export artefacts. Production deployments
// wire this to S3 (Cloud) or MinIO (self-host) via the
// `STORAGE_BACKEND` env var; until that adapter is glued in we return
// a stub URL so the rest of the pipeline (job state machine, email,
// downstream UI) can integration-test end-to-end.
import "server-only";

/**
 * Upload a zipped export to backed storage and return a time-limited
 * signed URL.
 *
 * Accepts `Buffer | NodeJS.ReadableStream` — the worker currently
 * passes a Buffer (no streaming yet) but the surface lets us swap in
 * `Readable.from(...)` when the real exporter ships.
 */
export async function uploadZip(
  key: string,
  _payload: Buffer | NodeJS.ReadableStream
): Promise<{ signedUrl: string; expiresAt: Date }> {
  // Stub: in production, upload to S3 + generate a presigned GET URL.
  return {
    signedUrl: `https://example.com/exports/${key}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}
