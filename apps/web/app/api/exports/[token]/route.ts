// apps/web/app/api/exports/[token]/route.ts
//
// HMAC-signed download endpoint for GDPR export artefacts stored on
// the local filesystem (`FilesystemAdapter`). Production deploys that
// use S3 never hit this route — the signed URL points straight at the
// bucket.
//
// The token encodes `{ storageKey, expiry }` HMAC'd with
// `COOKIE_SIGNING_SECRET` (see `lib/gdpr/signed-url.ts`). We verify
// constant-time, reject expired tokens, and stream the file from
// `GDPR_EXPORT_DIR` back to the client. No DB lookup is required.
//
// Security posture:
//   - Token is opaque; expiry is encoded inside it and signed.
//   - `verifyExportToken` rejects `..` and absolute-path storage keys.
//   - We still flatten slashes when resolving the on-disk path (same
//     mapping the adapter uses on upload) — belt + suspenders.
//   - We use `createReadStream` so a 5 GB export doesn't pin the
//     process; chunks flow straight through to the response body.
import { NextResponse, type NextRequest } from "next/server";
import { verifyExportToken } from "@/lib/gdpr/signed-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const decoded = decodeURIComponent(token);
  const verified = await verifyExportToken(decoded);
  if (!verified) {
    return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 401 });
  }

  const { createReadStream } = await import("node:fs");
  const { stat } = await import("node:fs/promises");
  const path = await import("node:path");

  const dir = process.env["GDPR_EXPORT_DIR"] ?? "/tmp/orchester-exports";
  const filePath = path.join(dir, verified.storageKey.replace(/\//g, "_"));

  // path.resolve to guarantee we stay inside `dir` — even though
  // `verifyExportToken` already rejects `..` keys and we flatten
  // slashes, a sanity check here keeps the invariant local.
  const resolved = path.resolve(filePath);
  const resolvedDir = path.resolve(dir);
  if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  let size: number;
  try {
    const st = await stat(resolved);
    if (!st.isFile()) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    size = st.size;
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const stream = createReadStream(resolved);
  // Cast: Node ReadStream is web-compat enough for Next.js response
  // bodies. Next's Response accepts ReadableStream | ReadStream.
  return new Response(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-length": String(size),
      "content-disposition": `attachment; filename="${path.basename(resolved)}"`,
      "cache-control": "private, no-store",
    },
  });
}
