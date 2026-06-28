import { NextResponse } from "next/server";
import { verifySigned } from "@/lib/cookies";
import { exchangeOAuthCode } from "@/lib/integrations/oauth";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${baseUrl(req)}/settings/integrations?oauth_error=${encodeURIComponent(error)}`
    );
  }
  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  const payload = await verifySigned(state);
  if (!payload) {
    return NextResponse.json({ error: "Invalid state — possible CSRF attempt" }, { status: 400 });
  }

  const colonIdx = payload.indexOf(":");
  if (colonIdx < 0) {
    return NextResponse.json({ error: "Malformed state" }, { status: 400 });
  }
  const workspaceId = payload.slice(0, colonIdx);
  const integrationId = payload.slice(colonIdx + 1);
  const redirectUri = `${baseUrl(req)}/api/integrations/oauth/${provider}/callback`;

  try {
    await exchangeOAuthCode({ workspaceId, integrationId, provider, code, redirectUri });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.redirect(
      `${baseUrl(req)}/settings/integrations?oauth_error=${encodeURIComponent(msg)}`
    );
  }

  return NextResponse.redirect(`${baseUrl(req)}/settings/integrations?connected=1`);
}

function baseUrl(req: Request): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}
