import { NextResponse } from "next/server";
import { getWhatsNew } from "@/lib/compass/whats-new";

/**
 * GET /api/compass/whats-new — return parsed CHANGELOG entries for the
 * HelpDrawer's "What's new" section.
 *
 * Public, unauthenticated: the changelog is shipped in the repo and is
 * already public. Cached for 60s at the edge (matches the in-process
 * cache TTL in `getWhatsNew`).
 *
 * Graceful: any failure inside `getWhatsNew` resolves to `[]`, so this
 * handler never needs to surface a 500 to the client.
 */
export async function GET() {
  const entries = await getWhatsNew();
  return NextResponse.json(entries, {
    headers: {
      "Cache-Control": "public, max-age=60",
    },
  });
}
