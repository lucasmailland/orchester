import "server-only";
import { NextResponse } from "next/server";
import type { Session } from "better-auth";
import { getCurrentSession, getCurrentWorkspace } from "./workspace";

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
