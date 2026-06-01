// packages/db/src/schema/orgs.ts
//
// v2 — Org primitive. Lightweight container above `workspace` so the
// cross-workspace consolidation flows (and any future enterprise
// SSO / billing-account aggregations) have a stable boundary to
// scope against.
//
// 1:1 personal-org backfill ships in migration 0049 — every existing
// workspace gets a personal org keyed `org_<workspaceId>`. Operational
// behaviour is unchanged; this is purely additive infrastructure.

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const orgs = pgTable("org", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /**
   * Free-text owner reference (mirror of `workspace.owner_user_id`).
   * NOT a FK because orgs may outlive specific users (ownership
   * transfers, deletions). App code handles NULL explicitly.
   */
  ownerUserId: text("owner_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
