import "server-only";
import { assertPublicUrl } from "@/lib/net-guard";
import { fetchWithTimeout } from "@/lib/http-util";
import { extractTextFromBuffer } from "@/lib/chunking";

const KB_URL_TIMEOUT_MS = 20_000;
const KB_URL_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** Fetch a user-provided URL for KB ingestion: SSRF-guarded, timed, size-capped. */
export async function fetchUrlForIngest(url: string): Promise<string> {
  if (process.env.ALLOW_PRIVATE_HTTP !== "1") assertPublicUrl(url);
  const r = await fetchWithTimeout(
    url,
    { headers: { "user-agent": "Orchester KB Ingest/1.0" } },
    KB_URL_TIMEOUT_MS
  );
  if (!r.ok) throw new Error(`URL returned ${r.status}`);
  const declared = Number(r.headers.get("content-length") ?? "0");
  if (declared > KB_URL_MAX_BYTES) throw new Error("Document too large");
  const upstreamCT = r.headers.get("content-type") ?? "";
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > KB_URL_MAX_BYTES) throw new Error("Document too large");
  if (upstreamCT.startsWith("application/pdf") || upstreamCT.includes("officedocument")) {
    return extractTextFromBuffer(buf, upstreamCT.split(";")[0]!);
  }
  return buf
    .toString("utf8")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
