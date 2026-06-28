import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { loadIntegration } from "@/lib/integrations/store";
import { buildAuthorizeUrl } from "@/lib/integrations/oauth";
import { signValue } from "@/lib/cookies";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const integrationId = url.searchParams.get("integration_id");
  if (!integrationId)
    return NextResponse.json({ error: "Missing integration_id" }, { status: 400 });

  const auth = await requireAuth({ minRole: "admin" });
  if (auth instanceof Response) return auth;

  const integration = await loadIntegration(auth.workspace.id, integrationId);
  if (!integration) return NextResponse.json({ error: "Integration not found" }, { status: 404 });

  const clientId = integration.config.clientId as string | undefined;
  if (!clientId)
    return NextResponse.json(
      { error: "OAuth app not configured (missing clientId)" },
      { status: 400 }
    );

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3333";
  const redirectUri = `${appUrl}/api/integrations/oauth/${provider}/callback`;
  const statePayload = `${auth.workspace.id}:${integrationId}`;
  const state = await signValue(statePayload);
  const authorizeUrl = buildAuthorizeUrl(provider, { clientId, redirectUri, state });

  return NextResponse.redirect(authorizeUrl);
}
