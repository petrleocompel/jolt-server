import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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

/**
 * What sent a poke: the account holder in person (`app` — the iOS app or
 * the web dashboard, both on a session), or a personal access token. Stored
 * rather than inferred from `api_token_id`, which is nulled when the token
 * is revoked — the poke was still automated.
 */
export const pokeSource = pgEnum("poke_source", ["app", "api_token"]);

export const userRole = pgEnum("user_role", ["user", "admin"]);

/**
 * Which friends a personal access token may reach. `selected` is a state of
 * its own rather than "whatever `api_token_friend` lists": a list emptied by
 * unfriending must keep meaning *nobody*, never quietly fall back to
 * everyone.
 */
export const apiTokenFriendScope = pgEnum("api_token_friend_scope", ["all", "selected"]);

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
    /**
     * Whether this friend's automations (their personal access tokens) may
     * send this kind too. Null is "no answer yet", which follows the server
     * policy — allowed unless consent is required. An explicit answer always
     * wins, and changing the policy never rewrites one.
     */
    automationAllowed: boolean("automation_allowed"),
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
 * A personal access token: a long-lived credential a user mints for their own
 * scripts, so a third-party integration can jolt *them* — or, given the
 * scopes for it, poke their friends — without being handed an account
 * password or a session that expires underneath it.
 *
 * Only the sha256 of the secret is stored. The secret is shown once, at
 * creation, and is unrecoverable afterwards — a leaked database gives an
 * attacker hashes, not working tokens.
 */
export const apiToken = pgTable(
  "api_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** What the user called it — "home assistant", "focus timer". */
    name: text("name").notNull(),
    /** Hex sha256 of the presented secret. Unique so a lookup is one index hit. */
    tokenHash: text("token_hash").notNull().unique(),
    /** Leading characters of the secret, so a row is recognisable in the list. */
    prefix: text("prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Coarse: only written when it moves by more than a minute. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    /** Null means it lives until revoked. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /**
     * What the token may do — `ApiTokenScope` in src/api/schemas.ts. Text
     * rather than an enum so a scope added later needs no migration, and so
     * `*` can keep meaning "every scope, including ones that don't exist
     * yet". Unknown values are dropped when the row is read.
     */
    scopes: text("scopes").array().notNull(),
    /** `selected` means only the friends listed in `api_token_friend`. */
    friendScope: apiTokenFriendScope("friend_scope").notNull().default("all"),
    /**
     * Limits the owner set at minting, applied on top of — never instead
     * of — whatever the recipient's grant allows. Null kinds is every kind;
     * null intensity is "the recipient's cap and nothing lower".
     */
    allowedKinds: stimulusKind("allowed_kinds").array(),
    maxIntensity: integer("max_intensity"),
    /** Minimum gap between two stimuli fired with this token, self or friend. */
    minIntervalSeconds: integer("min_interval_seconds").notNull().default(1),
    /**
     * When this token last fired. Written only by the conditional UPDATE in
     * `reserveTokenFire`, which is what makes `minIntervalSeconds` hold
     * across instances and restarts rather than per process.
     */
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
  },
  (t) => [
    index("api_token_user_idx").on(t.userId),
    // An empty scope list is a token that can do nothing but `GET /me` —
    // never what anyone meant to mint.
    check("api_token_scopes_nonempty", sql`cardinality(${t.scopes}) > 0`),
    check(
      "api_token_allowed_kinds_nonempty",
      sql`${t.allowedKinds} IS NULL OR cardinality(${t.allowedKinds}) > 0`,
    ),
    check(
      "api_token_max_intensity_range",
      sql`${t.maxIntensity} IS NULL OR (${t.maxIntensity} >= 0 AND ${t.maxIntensity} <= 100)`,
    ),
    check(
      "api_token_min_interval_range",
      sql`${t.minIntervalSeconds} >= 1 AND ${t.minIntervalSeconds} <= 86400`,
    ),
  ],
);

/**
 * The friends a `friend_scope = 'selected'` token may reach. Rows go when
 * the friendship does (see `unfriend`), so a token never keeps a handle on
 * somebody its owner has since dropped — and an emptied list stays empty.
 */
export const apiTokenFriend = pgTable(
  "api_token_friend",
  {
    tokenId: uuid("token_id")
      .notNull()
      .references(() => apiToken.id, { onDelete: "cascade" }),
    friendId: text("friend_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.tokenId, t.friendId] }),
    // Serves the unfriend cleanup, which looks rows up by friend.
    index("api_token_friend_friend_idx").on(t.friendId),
  ],
);

/**
 * Server-wide settings an admin can change at runtime, one row per key.
 * Read through src/services/settings.ts, which also lets an environment
 * variable override — and lock — any of them.
 */
export const serverSetting = pgTable("server_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** The admin who last changed it; kept as history if they are deleted. */
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
});

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
    source: pokeSource("source").notNull().default("app"),
    /**
     * The token that sent it, while that token exists. Only ever shown to
     * the sender — the recipient learns that a poke was automated, not what
     * their friend named the script.
     */
    apiTokenId: uuid("api_token_id").references(() => apiToken.id, { onDelete: "set null" }),
  },
  (t) => [
    index("poke_event_recipient_idx").on(t.recipientId, t.createdAt.desc()),
    index("poke_event_sender_idx").on(t.senderId, t.createdAt.desc()),
    // Serves the per-kind cooldown lookup on send.
    index("poke_event_cooldown_idx").on(t.senderId, t.recipientId, t.kind, t.createdAt.desc()),
    // Revoking a token nulls its pokes' `api_token_id`; without this that is
    // a scan of every poke ever sent.
    index("poke_event_api_token_idx").on(t.apiTokenId).where(sql`${t.apiTokenId} IS NOT NULL`),
    check("poke_event_intensity_range", sql`${t.intensity} >= 0 AND ${t.intensity} <= 100`),
    check("poke_event_repetitions_range", sql`${t.repetitions} >= 1 AND ${t.repetitions} <= 5`),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ many }) => ({
  devices: many(deviceToken),
  apiTokens: many(apiToken),
  sentPokes: many(pokeEvent, { relationName: "pokeSender" }),
  receivedPokes: many(pokeEvent, { relationName: "pokeRecipient" }),
}));

export const deviceTokenRelations = relations(deviceToken, ({ one }) => ({
  user: one(user, { fields: [deviceToken.userId], references: [user.id] }),
}));

export const apiTokenRelations = relations(apiToken, ({ one, many }) => ({
  user: one(user, { fields: [apiToken.userId], references: [user.id] }),
  friends: many(apiTokenFriend),
}));

export const apiTokenFriendRelations = relations(apiTokenFriend, ({ one }) => ({
  token: one(apiToken, { fields: [apiTokenFriend.tokenId], references: [apiToken.id] }),
  friend: one(user, { fields: [apiTokenFriend.friendId], references: [user.id] }),
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
export type ApiTokenRow = typeof apiToken.$inferSelect;
export type ApiTokenFriendRow = typeof apiTokenFriend.$inferSelect;
export type PokeEvent = typeof pokeEvent.$inferSelect;
export type ServerSetting = typeof serverSetting.$inferSelect;
