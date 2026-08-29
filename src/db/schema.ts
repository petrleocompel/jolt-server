import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const stimulusKind = pgEnum("stimulus_kind", ["zap", "vibe", "beep"]);

/**
 * Mirrors `PokeDeliveryStatus` in openapi/jolt-v1.yaml. Every poke is created
 * `pending`; only an ack from the recipient's device moves it to a terminal
 * value.
 */
export const pokeDeliveryStatus = pgEnum("poke_delivery_status", [
  "pending",
  "fired",
  "deviceNotConnected",
  "notAllowed",
  "muted",
]);

export const friendRequestStatus = pgEnum("friend_request_status", [
  "pending",
  "accepted",
  "rejected",
]);

export const devicePlatform = pgEnum("device_platform", ["ios"]);

export const userRole = pgEnum("user_role", ["user", "admin"]);

// ---------------------------------------------------------------------------
// Better Auth tables
//
// Property names must match Better Auth's model fields exactly — its Drizzle
// adapter resolves by TS key, not by DB column name. Ids are text, but we
// configure Better Auth to generate UUIDs into them so they satisfy the
// spec's `format: uuid` (see src/auth/server.ts).
// ---------------------------------------------------------------------------

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    // Peelco additions, surfaced through Better Auth `user.additionalFields`.
    /** Unique, lowercase. No discovery — this is how friends find you. */
    handle: text("handle").notNull().unique(),
    /** Shown as text + QR in the app's "Add friend" sheet. */
    inviteCode: text("invite_code").notNull().unique(),
    role: userRole("role").notNull().default("user"),
  },
  (t) => [
    check("user_handle_format", sql`${t.handle} ~ '^[a-z0-9_]{3,20}$'`),
  ],
);

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  /**
   * Required by Better Auth >= 1.7. Its absence made *every* sign-up fail
   * with `The field "issuer" does not exist in the "account" Drizzle schema`,
   * a 500 from both /api/v1/auth/signup and the web form — so nobody could
   * register, and the app reported a stale token as an expired session.
   *
   * Nullable in the database: rows written by 1.6.x predate the column, and
   * Better Auth fills it in on every account it creates from now on.
   */
  issuer: text("issuer"),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Domain tables
// ---------------------------------------------------------------------------

/**
 * One row per friendship, not two. `userA`/`userB` are stored in a canonical
 * order (userA < userB) so the unique index catches duplicates regardless of
 * who sent the request, and unfriending is a single delete.
 */
export const friendship = pgTable(
  "friendship",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userA: text("user_a")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    userB: text("user_b")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("friendship_pair_key").on(t.userA, t.userB),
    check("friendship_canonical_order", sql`${t.userA} < ${t.userB}`),
    index("friendship_user_a_idx").on(t.userA),
    index("friendship_user_b_idx").on(t.userB),
  ],
);

/**
 * Directional grant: `granter` allows `grantee` to send them `kind`.
 * Always edited from the granter's side. Accepting a request seeds all six
 * rows (3 stimuli x 2 directions) disabled.
 */
export const friendPermission = pgTable(
  "friend_permission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    granterId: text("granter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    granteeId: text("grantee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: stimulusKind("kind").notNull(),
    isAllowed: boolean("is_allowed").notNull().default(false),
    maxIntensity: integer("max_intensity").notNull().default(0),
    /** Minimum seconds between pokes of this kind from this friend. */
    cooldownSeconds: integer("cooldown_seconds").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("friend_permission_key").on(t.granterId, t.granteeId, t.kind),
    index("friend_permission_grantee_idx").on(t.granteeId),
    check("friend_permission_no_self", sql`${t.granterId} <> ${t.granteeId}`),
    check(
      "friend_permission_intensity_range",
      sql`${t.maxIntensity} >= 0 AND ${t.maxIntensity} <= 100`,
    ),
    check("friend_permission_cooldown_positive", sql`${t.cooldownSeconds} >= 0`),
  ],
);

export const friendRequest = pgTable(
  "friend_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromUserId: text("from_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    toUserId: text("to_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: friendRequestStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    // Only one *pending* request per ordered pair; resolved ones stay as history.
    uniqueIndex("friend_request_pending_key")
      .on(t.fromUserId, t.toUserId)
      .where(sql`${t.status} = 'pending'`),
    index("friend_request_to_idx").on(t.toUserId, t.status),
    index("friend_request_from_idx").on(t.fromUserId, t.status),
    check("friend_request_no_self", sql`${t.fromUserId} <> ${t.toUserId}`),
  ],
);

/** A user may have several devices; poke pushes fan out to all of them. */
export const deviceToken = pgTable(
  "device_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    platform: devicePlatform("platform").notNull().default("ios"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when APNs returns 410 Unregistered. Culled later by cron. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [index("device_token_user_idx").on(t.userId, t.disabledAt)],
);

/**
 * One row per poke, shared by both participants. `direction` in the API is
 * derived per viewer rather than stored, so a poke can never disagree with
 * itself across the two activity feeds.
 */
export const pokeEvent = pgTable(
  "poke_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderId: text("sender_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: stimulusKind("kind").notNull(),
    intensity: integer("intensity").notNull(),
    repetitions: integer("repetitions").notNull(),
    status: pokeDeliveryStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** First ack wins — subsequent acks are no-ops (spec requires idempotency). */
    ackedAt: timestamp("acked_at", { withTimezone: true }),
  },
  (t) => [
    index("poke_event_recipient_idx").on(t.recipientId, t.createdAt.desc()),
    index("poke_event_sender_idx").on(t.senderId, t.createdAt.desc()),
    // Serves the per-kind cooldown lookup on send.
    index("poke_event_cooldown_idx").on(t.senderId, t.recipientId, t.kind, t.createdAt.desc()),
    check("poke_event_intensity_range", sql`${t.intensity} >= 0 AND ${t.intensity} <= 100`),
    check("poke_event_repetitions_range", sql`${t.repetitions} >= 1 AND ${t.repetitions} <= 5`),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ many }) => ({
  devices: many(deviceToken),
  sentPokes: many(pokeEvent, { relationName: "pokeSender" }),
  receivedPokes: many(pokeEvent, { relationName: "pokeRecipient" }),
}));

export const deviceTokenRelations = relations(deviceToken, ({ one }) => ({
  user: one(user, { fields: [deviceToken.userId], references: [user.id] }),
}));

export const pokeEventRelations = relations(pokeEvent, ({ one }) => ({
  sender: one(user, {
    fields: [pokeEvent.senderId],
    references: [user.id],
    relationName: "pokeSender",
  }),
  recipient: one(user, {
    fields: [pokeEvent.recipientId],
    references: [user.id],
    relationName: "pokeRecipient",
  }),
}));

export type User = typeof user.$inferSelect;
export type Friendship = typeof friendship.$inferSelect;
export type FriendPermission = typeof friendPermission.$inferSelect;
export type FriendRequestRow = typeof friendRequest.$inferSelect;
export type DeviceToken = typeof deviceToken.$inferSelect;
export type PokeEvent = typeof pokeEvent.$inferSelect;
