import "server-only";
import { NextResponse } from "next/server";
import type { Session } from "better-auth";
import { getCurrentSession, getCurrentWorkspace } from "./workspace";
import { withTenantContext } from "./tenant/context";
import { TenantContextError, type TenantContext } from "./tenant/types";
import type { CrossTenantTx } from "./tenant/cron";

export type Role = "owner" | "admin" | "editor" | "viewer";

export interface AuthContext {
  session: Session;
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string; slug: string };
  role: Role;
}

/**
 * Helper único para autenticación + autorización en route handlers.
 *
 * Uso:
 *   const ctx = await requireAuth({ minRole: "admin" });
 *   if (ctx instanceof Response) return ctx;
 *   // ctx.workspace.id está garantizado, role chequeado
 *
 * Permite enforcar roles uniformemente y elimina el patrón repetido:
 *   if (!ws.role !== "owner" && ws.role !== "admin") return 403
 *
 * Devuelve `Response` 401/403 listo para retornar O un AuthContext válido.
 */
export async function requireAuth(
  opts: {
    minRole?: Role;
    /** Si true, no requiere workspace activo (sólo session). Útil para `/api/me`. */
    workspaceOptional?: boolean;
  } = {}
): Promise<AuthContext | Response> {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ws = await getCurrentWorkspace();
  if (!ws) {
    if (opts.workspaceOptional) {
      // Sin workspace, igual devolvemos el session — el caller puede usar
      // sólo `session.user`.
      return {
        session: session as unknown as Session,
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name ?? "",
        },
        // No tiene workspace → llenamos con stubs vacíos. El caller debe
        // chequear `workspaceOptional` antes de usar workspace.
        workspace: { id: "", name: "", slug: "" },
        role: "viewer",
      };
    }
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }
  const role = ws.role as Role;

  if (opts.minRole && !satisfiesRole(role, opts.minRole)) {
    return NextResponse.json(
      { error: `Insufficient role: ${role} < ${opts.minRole}` },
      { status: 403 }
    );
  }

  return {
    session: session as unknown as Session,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? "",
    },
    workspace: { id: ws.workspace.id, name: ws.workspace.name, slug: ws.workspace.slug },
    role,
  };
}

const ROLE_LEVEL: Record<Role, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

/** True si el role del caller cumple el mínimo requerido. */
export function satisfiesRole(actual: Role, required: Role): boolean {
  return (ROLE_LEVEL[actual] ?? -1) >= (ROLE_LEVEL[required] ?? 99);
}

/** Type guard para narrow después de `if (ctx instanceof Response) return ctx`. */
export function isAuthContext(x: AuthContext | Response): x is AuthContext {
  return !(x instanceof Response);
}

/**
 * Tenant-scoped action wrapper for route handlers.
 *
 * Combines `requireAuth`'s role gate with `withTenantContext`'s per-tx
 * `SET LOCAL ROLE app_user` + `app.workspace_id` GUC so every query inside
 * `run` is automatically tenant-filtered by RLS + FORCE.
 *
 * Returns either the callback's value OR an error Response (401/403/404/410/423).
 * Pattern: `const r = await requireAction({...}); if (r instanceof Response) return r;`
 */
export async function requireAction<T>(opts: {
  minRole?: Role;
  run: (args: { ctx: TenantContext; user: AuthContext["user"]; tx: CrossTenantTx }) => Promise<T>;
}): Promise<T | Response> {
  const auth = await requireAuth(opts.minRole ? { minRole: opts.minRole } : {});
  if (auth instanceof Response) return auth;
  try {
    return await withTenantContext(auth.workspace.id, async (ctx, tx) => {
      return opts.run({ ctx, user: auth.user, tx });
    });
  } catch (e) {
    if (e instanceof TenantContextError) {
      const statusMap: Record<string, number> = {
        no_session: 401,
        not_a_member: 403,
        workspace_not_found: 404,
        workspace_deleted: 410,
        workspace_suspended: 423,
        no_tenant_in_request: 400,
      };
      return NextResponse.json({ error: e.code }, { status: statusMap[e.code] ?? 500 });
    }
    throw e;
  }
}
