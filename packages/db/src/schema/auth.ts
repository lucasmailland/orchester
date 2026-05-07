import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  preferredLocale: text("preferred_locale").default("en"),
  preferredTheme: text("preferred_theme").default("light"),
  /** True si el user habilitó 2FA TOTP. Si está activo, el login pide código tras password. */
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Tabla del plugin twoFactor de better-auth. Contiene el secret TOTP cifrado
 * a nivel app + 10 backup codes (también cifrados). El plugin lee/escribe acá.
 *
 * Nunca retornado al cliente: el `returned: false` del plugin asegura que
 * `secret` y `backupCodes` no aparecen en respuestas de la API.
 */
export const twoFactors = pgTable("two_factor", {
  id: text("id").primaryKey(),
  /** TOTP secret en base32, encriptado con BETTER_AUTH_SECRET (no nuestro
   *  ENCRYPTION_SECRET — es responsabilidad del plugin). */
  secret: text("secret").notNull(),
  /** Backup codes serializados como JSON-string con 10 códigos one-shot. */
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(true),
});

export const sessions = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  activeWorkspaceId: text("active_workspace_id"),
});

export const accounts = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
