import { z } from "zod";
import "#/lib/zod-locale";

/**
 * Runtime mirror of openapi/jolt-v1.yaml. The YAML is the canonical contract;
 * `pnpm openapi:check` compares these schemas against it and fails CI when
 * the two drift apart.
 */

// --- Components -------------------------------------------------------------

export const StimulusKind = z.enum(["zap", "vibe", "beep"]);

export const StimulusConfig = z.object({
  kind: StimulusKind,
  intensity: z.int().min(0).max(100),
  repetitions: z.int().min(1).max(5),
});

/** The three keys every client has always sent and read. */
const StimulusGrant = z.object({
  isAllowed: z.boolean(),
  maxIntensity: z.int().min(0).max(100),
  cooldownSeconds: z.int().min(0),
});

/**
 * One direction of one stimulus between two friends, as the server reports
 * it. The automation keys are additions: an app built before them ignores
 * them and keeps working.
 */
export const StimulusPermission = StimulusGrant.extend({
  /**
   * The granter's explicit answer to "may their automations (API tokens)
   * send me this?" — or null for no answer, which follows the server policy.
   */
  automationAllowed: z.boolean().nullable(),
  /** What actually applies right now: the answer, or the policy for null. */
  automationAllowedEffective: z.boolean(),
});

/**
 * The body of `PUT /friends/{id}/permissions/{kind}`. The three grant keys
 * overwrite, as they always have. `automationAllowed` is different on
 * purpose: *absent* leaves the stored answer alone — an app that predates it
 * sends only the three, and must not wipe an answer it cannot see — while
 * `null` explicitly hands the decision back to the server policy.
 */
export const StimulusPermissionUpdate = StimulusGrant.extend({
  automationAllowed: z.boolean().nullable().optional(),
});

export const FriendPermissionSet = z.object({
  zap: StimulusPermission,
  vibe: StimulusPermission,
  beep: StimulusPermission,
});

export const User = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
});

/** Server-wide rules a client may want to explain to its user. */
export const ServerPolicies = z.object({
  /**
   * True: a friend's automations may not poke you until you allow them, per
   * friend and kind. False: they may, unless you turn them off.
   */
  automationConsentRequired: z.boolean(),
});

export const Me = User.extend({
  email: z.email(),
  inviteCode: z.string(),
  policies: ServerPolicies,
});

export const AuthResponse = z.object({
  token: z.string(),
  user: Me,
});

export const Friend = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  /** What THEY allow you to send them — drives the poke composer. */
  permissionsGrantedToMe: FriendPermissionSet,
  /** What you allow THEM to send you — yours to edit. */
  permissionsIGranted: FriendPermissionSet,
});

export const FriendRequest = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  direction: z.enum(["incoming", "outgoing"]),
  createdAt: z.iso.datetime(),
});

export const FriendRequests = z.object({
  incoming: z.array(FriendRequest),
  outgoing: z.array(FriendRequest),
});

export const PokeDeliveryStatus = z.enum([
  "pending",
  "fired",
  "deviceNotConnected",
  "notAllowed",
  "muted",
]);

/** The states a device may report. `pending` is server-assigned only. */
export const AckableStatus = z.enum(["fired", "deviceNotConnected", "notAllowed", "muted"]);

export const PokeEvent = z.object({
  id: z.uuid(),
  direction: z.enum(["sent", "received"]),
  friendHandle: z.string(),
  friendDisplayName: z.string(),
  stimulus: StimulusConfig,
  status: PokeDeliveryStatus,
  createdAt: z.iso.datetime(),
  /** When the recipient's device reported back. Null while `pending`. */
  ackedAt: z.iso.datetime().nullable(),
  /** Sent through a personal access token rather than by the person. */
  viaApiToken: z.boolean(),
  /**
   * Which token, by the name its owner gave it — for the sender only, and
   * only while the token exists. Always null for the recipient.
   */
  apiTokenName: z.string().nullable(),
});

export const PokePushPayload = z.object({
  pokeID: z.uuid(),
  senderHandle: z.string(),
  senderDisplayName: z.string(),
  /**
   * Who the poke is *for*. A device can be registered to only one account at
   * a time, but a stale registration (account switched, token reassigned)
   * used to be invisible: a push addressed to somebody else arrived, fired,
   * and the only trace was an ack the server 404'd. A client that knows its
   * own handle can now drop a poke that isn't its own instead of shocking
   * the wrong person.
   */
  recipientHandle: z.string(),
  stimulus: StimulusConfig,
  /** Server-side accept time. The alert body renders it; clients may re-render it locally. */
  sentAt: z.iso.datetime(),
  /** Sent by a friend's automation, not by the friend in person. */
  viaApiToken: z.boolean(),
  /**
   * The relay `serverId` of the sending server. Present on pushes delivered
   * through the relay, where the app checks it against the envelope's `srv`.
   */
  serverId: z.string().optional(),
});

export const DevicePlatform = z.enum(["ios", "android"]);

/** How a registered device's pushes leave the server. */
export const PushTransport = z.enum(["apns", "relay"]);

/**
 * One of the signed-in user's registered devices. Only the tail of the APNs
 * token (or relay token) is exposed — enough for a phone to recognise itself
 * in the list.
 */
export const Device = z.object({
  id: z.uuid(),
  platform: DevicePlatform,
  transport: PushTransport,
  tokenSuffix: z.string(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});

/** Per-device outcome of a test push, as APNs reported it. */
export const TestPushDeviceResult = z.object({
  deviceId: z.uuid(),
  ok: z.boolean(),
  reason: z.enum(["unregistered", "transient", "rejected"]).optional(),
  detail: z.string().optional(),
});

/**
 * A device confirming a test push arrived. `path` says which iOS entry point
 * saw it, so the alert and background halves can be told apart.
 */
export const TestPushAck = z.object({
  deviceId: z.uuid().nullable(),
  path: z.enum(["alert", "background", "foreground"]),
  status: AckableStatus.optional(),
  receivedAt: z.iso.datetime(),
  elapsedMs: z.int().min(0),
});

/**
 * The live state of one test push: what APNs said, plus whatever the devices
 * have confirmed so far. Held in memory for ten minutes — see
 * src/services/push-test.ts.
 */
export const TestPushStatus = z.object({
  testID: z.uuid(),
  sentAt: z.iso.datetime(),
  source: z.enum(["web", "app"]),
  stimulus: StimulusConfig.optional(),
  /**
   * False when the server is running the console stub instead of delivering.
   * Kept for clients that predate `pushTransport`; true for the relay too.
   */
  apnsConfigured: z.boolean(),
  /** How this server delivers pushes: its own APNs credentials, the relay, or not at all. */
  pushTransport: z.enum(["apns", "relay", "none"]),
  devices: z.array(TestPushDeviceResult),
  acks: z.array(TestPushAck),
});

/** The `test` object inside a diagnostic APNs payload (`type: "test"`). */
export const TestPushPayload = z.object({
  testID: z.uuid(),
  deviceID: z.uuid(),
  sentAt: z.iso.datetime(),
  source: z.enum(["web", "app"]),
  stimulus: StimulusConfig.optional(),
  /** As on `PokePushPayload`: present on pushes delivered through the relay. */
  serverId: z.string().optional(),
});

/**
 * What `GET /push/config` tells the app to register with: the server's own
 * APNs (`apns`), the push relay (`relay`), or nothing (`none`).
 */
export const PushConfig = z.object({
  transport: z.enum(["apns", "relay", "none"]),
  /** Only for `apns`: which APNs environment the server's credentials target. */
  apnsEnvironment: z.enum(["sandbox", "production"]).optional(),
  /** Only for `relay`: where to register, and as which server. */
  relay: z.object({ url: z.url(), serverId: z.string() }).optional(),
});

/** base64url without padding, `bytes` long once decoded. */
function base64urlOf(bytes: number) {
  return z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((bytes * 4) / 3)}}$`));
}

/**
 * The original registration: an APNs device token the server pushes to
 * with its own credentials. No `transport` means `apns`, which is what keeps
 * every app build from before the relay working.
 */
export const ApnsPushTokenRegistration = z.object({
  transport: z.literal("apns").optional(),
  token: z.string().min(1),
  platform: z.literal("ios"),
});

/**
 * A device that registered with the push relay. The server never sees the
 * APNs or FCM token — only the relay's token for it, and the key the app
 * decrypts its pushes with.
 */
export const RelayPushTokenRegistration = z.object({
  transport: z.literal("relay"),
  platform: DevicePlatform,
  relayToken: z.string().regex(/^rt_[A-Za-z0-9_-]{43}$/),
  /** 32 random bytes, base64url. */
  payloadKey: base64urlOf(32),
  /** base64url of the first 8 bytes of SHA-256(payloadKey). */
  keyId: base64urlOf(8),
});

/**
 * What a personal access token may do. Defined once, here: the database
 * stores these strings, `requireCaller` checks them, and the dashboard lists
 * them.
 *
 * - `*`             every scope — including any added after the token was minted
 * - `stimulus:self` `POST /me/stimulus`
 * - `pokes:send`    `POST /pokes`, to the friends the token reaches
 * - `friends:read`  `GET /friends`, limited to the friends the token reaches
 * - `pokes:read`    `GET /pokes`, limited likewise
 *
 * `GET /me` needs none: any valid token may ask whose it is.
 */
export const ApiTokenScope = z.enum(["*", "stimulus:self", "pokes:send", "friends:read", "pokes:read"]);

/** `selected` reaches only `friendIds` — and an empty list reaches nobody. */
export const ApiTokenFriendScope = z.enum(["all", "selected"]);

/**
 * A personal access token as listed back to its owner. The secret itself is
 * returned exactly once, by the create call, and is unrecoverable after that.
 */
export const ApiToken = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Leading characters of the secret, so a row is recognisable in the list. */
  prefix: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  /** Null means it lives until revoked. */
  expiresAt: z.iso.datetime().nullable(),
  scopes: z.array(ApiTokenScope),
  friendScope: ApiTokenFriendScope,
  /** The friends a `selected` token reaches. Always empty for `all`. */
  friendIds: z.array(z.uuid()),
  /** The kinds it may fire. Null is every kind. */
  allowedKinds: z.array(StimulusKind).nullable(),
  /** Its own intensity ceiling. Null leaves only the recipient's cap. */
  maxIntensity: z.int().min(0).max(100).nullable(),
  /** Minimum seconds between two stimuli fired with it, self or friend. */
  minIntervalSeconds: z.int().min(1),
});

/** The one response that carries the secret. Store it now or mint a new one. */
export const ApiTokenCreated = ApiToken.extend({ token: z.string() });

export const ApiError = z.object({ message: z.string() });

// --- Request bodies ---------------------------------------------------------

export const SignupBody = z.object({
  email: z.email(),
  password: z.string().min(8),
  handle: z.string().regex(/^[a-z0-9_]{3,20}$/),
  displayName: z.string().min(1).max(50),
});

export const LoginBody = z.object({
  email: z.email(),
  password: z.string(),
});

/** One of the two registrations — see `ApnsPushTokenRegistration`. */
export const PushTokenBody = z.union([ApnsPushTokenRegistration, RelayPushTokenRegistration]);

/**
 * Sign-out: drop this phone from the account it was registered to, by the
 * token it registered with — whichever kind that was.
 */
export const ForgetPushTokenBody = z.union([
  z.object({ token: z.string().min(1) }),
  z.object({ relayToken: z.string().min(1) }),
]);

/**
 * Exactly one of handle / inviteCode — there is no discovery endpoint by
 * design, so a request always names someone specific.
 */
export const SendFriendRequestBody = z
  .object({
    handle: z.string().optional(),
    inviteCode: z.string().optional(),
  })
  .refine(
    (v) => Boolean(v.handle) !== Boolean(v.inviteCode),
    { message: "Provide exactly one of handle or inviteCode." },
  );

export const SendPokeBody = z.object({
  // Lowercased: IDs are stored lowercase (`crypto.randomUUID()`) in
  // case-sensitive `text` columns, but a client may send any casing.
  friendId: z.uuid().toLowerCase(),
  stimulus: StimulusConfig,
  /**
   * Client-chosen id for this poke. Sending the same one again returns the
   * poke already recorded instead of poking twice — what makes a retry after
   * a dropped connection safe, and what lets the client look the poke up in
   * the activity feed to learn whether it went through.
   */
  pokeId: z.uuid().toLowerCase().optional(),
});

export const AckBody = z.object({ status: AckableStatus });

/**
 * `deviceId` omitted means every active device; `stimulus` omitted means
 * notification only, leaving the wearable alone.
 */
export const TestPushBody = z
  .object({
    deviceId: z.uuid().optional(),
    stimulus: StimulusConfig.optional(),
  })
  // Strict for the same reason as `SelfStimulusBody`: this one also fires at
  // the caller's own devices, and both its fields are optional — a mistyped
  // or misrouted body would otherwise be accepted whole.
  .strict();

export const TestPushAckBody = z.object({
  deviceId: z.uuid().optional(),
  path: z.enum(["alert", "background", "foreground"]),
  status: AckableStatus.optional(),
});

/**
 * Strict for the same reason as `SelfStimulusBody`, with the stakes the
 * other way round: a misspelt `friendIds` stripped by Zod's default would
 * mint a token that reaches *every* friend instead of the few it named.
 */
export const CreateApiTokenBody = z
  .object({
    name: z.string().min(1).max(60),
    /** Omit for a token that lives until revoked. */
    expiresInDays: z.int().min(1).max(365).optional(),
    scopes: z.array(ApiTokenScope).min(1).max(ApiTokenScope.options.length),
    /**
     * Present (even empty) means the token reaches only these friends;
     * absent means every friend, now and later. Each must be a friend now.
     */
    friendIds: z.array(z.uuid().toLowerCase()).max(500).optional(),
    /**
     * Limits on what the token may fire, at yourself or at a friend. They
     * only ever narrow the recipient's grant. Null or absent: no limit of
     * the token's own.
     */
    allowedKinds: z.array(StimulusKind).min(1).max(StimulusKind.options.length).nullable().optional(),
    maxIntensity: z.int().min(0).max(100).nullable().optional(),
    /**
     * At least a second: the floor that keeps a looping script from
     * hammering APNs, whatever the recipient's cooldown says. A day at most.
     */
    minIntervalSeconds: z.int().min(1).max(86_400).optional(),
  })
  .strict();

/**
 * What to fire at your own devices. No friend, no grant — just you.
 *
 * Strict on purpose, and the strictness is the feature. This body and
 * `SendPokeBody` differ by exactly one field, so a caller that means
 * `POST /pokes` but hits this path would otherwise have its `friendId`
 * stripped by Zod's default and get a cheerful 201 — for a stimulus fired at
 * *itself*. A poke addressed to somebody else must never quietly become a
 * poke at the caller; `Unrecognized key: "friendId"` and a 400 says so on the
 * first request instead of on the caller's wrist.
 */
export const SelfStimulusBody = z.object({ stimulus: StimulusConfig }).strict();

export const PokesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.iso.datetime().optional(),
});

// --- Inferred types ---------------------------------------------------------

export type StimulusKind = z.infer<typeof StimulusKind>;
export type StimulusConfig = z.infer<typeof StimulusConfig>;
export type StimulusPermission = z.infer<typeof StimulusPermission>;
export type StimulusPermissionUpdate = z.infer<typeof StimulusPermissionUpdate>;
export type ServerPolicies = z.infer<typeof ServerPolicies>;
export type FriendPermissionSet = z.infer<typeof FriendPermissionSet>;
export type Me = z.infer<typeof Me>;
export type Friend = z.infer<typeof Friend>;
export type FriendRequest = z.infer<typeof FriendRequest>;
export type PokeEvent = z.infer<typeof PokeEvent>;
export type PokeDeliveryStatus = z.infer<typeof PokeDeliveryStatus>;
export type AuthResponse = z.infer<typeof AuthResponse>;
export type User = z.infer<typeof User>;
export type PokePushPayload = z.infer<typeof PokePushPayload>;
export type AckableStatus = z.infer<typeof AckableStatus>;
export type Device = z.infer<typeof Device>;
export type DevicePlatform = z.infer<typeof DevicePlatform>;
export type PushTransport = z.infer<typeof PushTransport>;
export type PushConfig = z.infer<typeof PushConfig>;
export type PushTokenBody = z.infer<typeof PushTokenBody>;
export type TestPushDeviceResult = z.infer<typeof TestPushDeviceResult>;
export type TestPushAck = z.infer<typeof TestPushAck>;
export type TestPushStatus = z.infer<typeof TestPushStatus>;
export type TestPushPayload = z.infer<typeof TestPushPayload>;
export type ApiTokenScope = z.infer<typeof ApiTokenScope>;
export type ApiTokenFriendScope = z.infer<typeof ApiTokenFriendScope>;
export type ApiToken = z.infer<typeof ApiToken>;
export type CreateApiTokenBody = z.infer<typeof CreateApiTokenBody>;
export type ApiTokenCreated = z.infer<typeof ApiTokenCreated>;

/** Named components, for the openapi:check drift comparison. */
export const components = {
  StimulusKind,
  StimulusConfig,
  StimulusPermission,
  StimulusPermissionUpdate,
  FriendPermissionSet,
  User,
  ServerPolicies,
  Me,
  AuthResponse,
  Friend,
  FriendRequest,
  PokeDeliveryStatus,
  PokeEvent,
  PokePushPayload,
  DevicePlatform,
  PushTransport,
  Device,
  TestPushDeviceResult,
  TestPushAck,
  TestPushStatus,
  TestPushPayload,
  PushConfig,
  ApnsPushTokenRegistration,
  RelayPushTokenRegistration,
  ApiTokenScope,
  ApiTokenFriendScope,
  ApiToken,
  ApiTokenCreated,
  Error: ApiError,
} as const;
