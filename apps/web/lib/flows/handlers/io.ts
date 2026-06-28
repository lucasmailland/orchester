import "server-only";
import type { NodeHandler } from "@/lib/flow-engine";
import { interpolate, deepInterpolate } from "@/lib/flows/runtime-helpers";
import { assertPublicUrlResolved } from "@/lib/net-guard";

export const http: NodeHandler = async ({ cfg, ctx, helpers }) => {
  const method = ((cfg.method as string) ?? "GET").toUpperCase();
  const url = interpolate(cfg.url as string, ctx.variables);
  if (process.env.ALLOW_PRIVATE_HTTP !== "1") {
    try {
      await assertPublicUrlResolved(url);
    } catch (e) {
      throw new Error(
        `La URL no está permitida por seguridad: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  const headers: Record<string, string> = { ...((cfg.headers as Record<string, string>) ?? {}) };
  const auth = cfg.auth as
    | {
        kind?: string;
        token?: string;
        user?: string;
        pass?: string;
        key?: string;
        header?: string;
      }
    | undefined;
  if (auth?.kind === "bearer" && auth.token) {
    headers["Authorization"] = `Bearer ${interpolate(auth.token, ctx.variables)}`;
  } else if (auth?.kind === "basic" && auth.user && auth.pass) {
    const encoded = Buffer.from(
      `${interpolate(auth.user, ctx.variables)}:${interpolate(auth.pass, ctx.variables)}`
    ).toString("base64");
    headers["Authorization"] = `Basic ${encoded}`;
  } else if (auth?.kind === "api_key" && auth.key) {
    const headerName = auth.header || "X-API-Key";
    headers[headerName] = interpolate(auth.key, ctx.variables);
  }

  const init: RequestInit = { method, headers };
  if (method !== "GET") {
    init.body = interpolate((cfg.body as string) ?? "", ctx.variables);
  }

  const maxAttempts = Math.min(5, Number(cfg.maxAttempts ?? 1));
  const timeoutMs = Math.min(60000, Number(cfg.timeoutMs ?? 30000));
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      const r = await fetch(url, { ...init, signal: ac.signal });
      clearTimeout(t);
      const text = await r.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {}
      if (!r.ok && attempt < maxAttempts) {
        await new Promise((res) => setTimeout(res, 200 * Math.pow(2, attempt - 1)));
        continue;
      }
      const outputVar = (cfg.outputVar as string) ?? "httpResult";
      ctx.variables[outputVar] = body;
      helpers.setOutput({ status: r.status, body, attempt });
      return;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxAttempts) {
        await new Promise((res) => setTimeout(res, 200 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastError ?? new Error("HTTP request failed after retries");
};

export const integration: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const raw = String(cfg.integrationId ?? "");
  const [integrationId, action] = raw.split("::");
  if (!integrationId || !action) throw new Error("Falta elegir la app y la acción.");
  const input = (deepInterpolate(cfg.input ?? {}, ctx.variables) as Record<string, unknown>) ?? {};
  const { runIntegrationAction } = await import("@/lib/integrations/store");
  const result = await runIntegrationAction(workspaceId, integrationId, action, input);
  const outputVar = (cfg.outputVar as string) ?? "appResult";
  ctx.variables[outputVar] = result;
  helpers.setOutput({ result });
};

export const notify: NodeHandler = async ({ cfg, ctx, helpers }) => {
  const channel = String(cfg.channel ?? "email");
  const to = cfg.to ? interpolate(cfg.to as string, ctx.variables) : "";
  const message = interpolate((cfg.message as string) ?? "", ctx.variables);
  if (channel === "email") {
    if (!to) throw new Error("notify: missing recipient");
    const { sendEmail } = await import("@/lib/email");
    await sendEmail({ to, subject: "Orchester flow notification", text: message });
    helpers.setOutput({ channel, to, sent: true });
    return;
  }
  // Don't silently echo for channels we can't deliver — fail loudly so a
  // "notify on failure" step is honest.
  throw new Error(`notify: channel "${channel}" not supported yet`);
};
