import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Local scaffold records only. These are not the R2 mailbox/envelope contract.
export const scaffoldWorkspaces = sqliteTable("scaffold_workspaces", {
  workspaceRef: text("workspace_ref").primaryKey(),
  ownerId: text("owner_id").notNull(),
  label: text("label").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("scaffold_workspaces_owner").on(table.ownerId, table.createdAt),
  check("scaffold_workspaces_label_length", sql`length(${table.label}) BETWEEN 1 AND 80`),
]);

export const scaffoldChallenges = sqliteTable("scaffold_challenges", {
  challengeHash: text("challenge_hash").primaryKey(),
  ownerId: text("owner_id").notNull(),
  deviceRef: text("device_ref").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [
  index("scaffold_challenges_owner_expiry").on(table.ownerId, table.expiresAt),
  index("scaffold_challenges_expiry").on(table.expiresAt),
  check("scaffold_challenges_expiry_order", sql`${table.expiresAt} > ${table.createdAt}`),
]);

export const scaffoldRateWindows = sqliteTable("scaffold_rate_windows", {
  ownerId: text("owner_id").primaryKey(),
  windowStart: integer("window_start").notNull(),
  expiresAt: integer("expires_at").notNull(),
  calls: integer("calls").notNull(),
}, (table) => [
  index("scaffold_rate_windows_expiry").on(table.expiresAt),
  check("scaffold_rate_windows_calls", sql`${table.calls} BETWEEN 1 AND 30`),
  check("scaffold_rate_windows_expiry_order", sql`${table.expiresAt} > ${table.windowStart}`),
]);

// Local conformance persistence: one bounded snapshot, serialized by revision CAS.
export const remoteScaffoldState = sqliteTable("remote_scaffold_state", {
  key: text("key").primaryKey(),
  revision: integer("revision").notNull().default(0),
  stateJson: text("state_json").notNull(),
}, (table) => [
  check("remote_scaffold_revision", sql`${table.revision} >= 0`),
  check("remote_scaffold_json", sql`json_valid(${table.stateJson})`),
]);
