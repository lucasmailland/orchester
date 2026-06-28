import "server-only";
import { getDb, schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/encryption";

const TOKEN_ENDPOINTS: Record<string, string> = {
  google: "https://oauth2.googleapis.com/token",
};

const AUTHORIZE_URLS: Record<string, string> = {
  google: "https://accounts.google.com/o/oauth2/v2/auth",
};

const DEFAULT_SCOPES: Record<string, string[]> = {
  google: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ],
};

export function buildAuthorizeUrl(
  provider: string,
  opts: { clientId: string; redirectUri: string; state: string; scopes?: string[] }
): string {
  const base = AUTHORIZE_URLS[provider];
  if (!base) throw new Error(`OAuth not configured for provider "${provider}"`);
  const scopes = (opts.scopes ?? DEFAULT_SCOPES[provider] ?? []).join(" ");
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
  });
  return `${base}?${params.toString()}`;
}

export interface OAuthExchangeOpts {
  workspaceId: string;
  integrationId: string;
  provider: string;
  code: string;
  redirectUri: string;
}

export async function exchangeOAuthCode(opts: OAuthExchangeOpts): Promise<void> {
  const db = getDb();
  const row = (
    await db
      .select()
      .from(schema.workspaceIntegrations)
      .where(
        and(
          eq(schema.workspaceIntegrations.id, opts.integrationId),
          eq(schema.workspaceIntegrations.workspaceId, opts.workspaceId)
        )
      )
      .limit(1)
  )[0];
  if (!row) throw new Error("Integration not found");

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(decrypt(row.configEncrypted)) as Record<string, unknown>;
  } catch {
    try {
      config = JSON.parse(row.configEncrypted) as Record<string, unknown>;
    } catch {
      /* keep empty */
    }
  }

  const endpoint = TOKEN_ENDPOINTS[opts.provider];
  if (!endpoint) throw new Error(`No OAuth token endpoint for provider "${opts.provider}"`);

  const body = new URLSearchParams({
    code: opts.code,
    client_id: String(config.clientId ?? ""),
    client_secret: String(config.clientSecret ?? ""),
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OAuth token exchange failed (${res.status}): ${err}`);
  }

  const j = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const newConfig = {
    ...config,
    tokens: {
      access_token: j.access_token,
      ...(j.refresh_token ? { refresh_token: j.refresh_token } : {}),
      ...(j.expires_in ? { expires_at: Date.now() + j.expires_in * 1000 } : {}),
    },
  };

  await db
    .update(schema.workspaceIntegrations)
    .set({
      configEncrypted: encrypt(JSON.stringify(newConfig)),
      status: "connected",
      lastTestedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.workspaceIntegrations.id, opts.integrationId),
        eq(schema.workspaceIntegrations.workspaceId, opts.workspaceId)
      )
    );
}
