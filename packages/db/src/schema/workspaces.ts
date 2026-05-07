import { pgTable, text, timestamp, pgEnum, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const workspaceMemberRoleEnum = pgEnum("workspace_member_role", [
  "owner",
  "admin",
  "editor",
  "viewer",
]);

export const workspaces = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** IANA timezone (e.g. "America/Argentina/Buenos_Aires"). Default UTC. */
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workspaceMembers = pgTable("workspace_member", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: workspaceMemberRoleEnum("role").notNull().default("viewer"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Preferencias de notificación. Hay 2 niveles:
 *   - workspace-level: ningún user_id → la pref aplica a todos los miembros del
 *     workspace (e.g. "Weekly usage report" se manda al owner).
 *   - user-level: user_id seteado → pref personal de ese miembro.
 *
 * Las keys conocidas hoy son:
 *   - conv_escalated   : se manda mail cuando un agente escala
 *   - agent_down       : se manda mail cuando un agente activo queda offline
 *   - weekly_report    : resumen semanal de tokens (lunes)
 *   - new_member       : alguien se sumó al workspace
 *
 * Para una nueva key sólo hay que agregarla al `NOTIFICATION_KEYS` del front
 * y al consumer que la lea (mailer / inbox).
 */
export const notificationPrefs = pgTable(
  "notification_pref",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** null = pref a nivel workspace; setteado = pref personal del user */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** Identificador estable de la pref. Ver NOTIFICATION_KEYS en el front. */
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Una sola fila por (workspace, user, key). Coalesce de NULL via `coalesce`
    // sería ideal pero Postgres no soporta unique en NULLs sin una expresión.
    // Uso 2 índices: uno para user-level (donde user_id no es null) y otro
    // para workspace-level (donde user_id es null).
    uniqUserPref: uniqueIndex("uniq_notification_pref_user").on(
      t.workspaceId,
      t.userId,
      t.key
    ),
  })
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceMemberRole = (typeof workspaceMemberRoleEnum.enumValues)[number];
export type NotificationPref = typeof notificationPrefs.$inferSelect;
export type NewNotificationPref = typeof notificationPrefs.$inferInsert;
