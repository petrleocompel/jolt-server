import { z } from "zod";

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

export const StimulusPermission = z.object({
  isAllowed: z.boolean(),
  maxIntensity: z.int().min(0).max(100),
  cooldownSeconds: z.int().min(0),
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

export const Me = User.extend({
  email: z.email(),
  inviteCode: z.string(),
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
});

export const PokePushPayload = z.object({
  pokeID: z.uuid(),
  senderHandle: z.string(),
  senderDisplayName: z.string(),
  stimulus: StimulusConfig,
  /** Server-side accept time. The alert body renders it; clients may re-render it locally. */
  sentAt: z.iso.datetime(),
});

/**
 * One of the signed-in user's registered devices. Only the tail of the APNs
 * token is exposed — enough for a phone to recognise itself in the list.
 */
export const Device = z.object({
  id: z.uuid(),
  platform: z.enum(["ios"]),
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
  /** False when the server is running the console stub instead of real APNs. */
  apnsConfigured: z.boolean(),
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
});

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

export const PushTokenBody = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios"]),
});

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
});

export const AckBody = z.object({ status: AckableStatus });

/**
 * `deviceId` omitted means every active device; `stimulus` omitted means
 * notification only, leaving the wearable alone.
 */
export const TestPushBody = z.object({
  deviceId: z.uuid().optional(),
  stimulus: StimulusConfig.optional(),
});

export const TestPushAckBody = z.object({
  deviceId: z.uuid().optional(),
  path: z.enum(["alert", "background", "foreground"]),
  status: AckableStatus.optional(),
});

export const CreateApiTokenBody = z.object({
  name: z.string().min(1).max(60),
  /** Omit for a token that lives until revoked. */
  expiresInDays: z.int().min(1).max(365).optional(),
});

/** What to fire at your own devices. No friend, no grant — just you. */
export const SelfStimulusBody = z.object({ stimulus: StimulusConfig });

export const PokesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.iso.datetime().optional(),
});

// --- Inferred types ---------------------------------------------------------

export type StimulusKind = z.infer<typeof StimulusKind>;
export type StimulusConfig = z.infer<typeof StimulusConfig>;
export type StimulusPermission = z.infer<typeof StimulusPermission>;
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
export type TestPushDeviceResult = z.infer<typeof TestPushDeviceResult>;
export type TestPushAck = z.infer<typeof TestPushAck>;
export type TestPushStatus = z.infer<typeof TestPushStatus>;
export type TestPushPayload = z.infer<typeof TestPushPayload>;
export type ApiToken = z.infer<typeof ApiToken>;
export type ApiTokenCreated = z.infer<typeof ApiTokenCreated>;

/** Named components, for the openapi:check drift comparison. */
export const components = {
  StimulusKind,
  StimulusConfig,
  StimulusPermission,
  FriendPermissionSet,
  User,
  Me,
  AuthResponse,
  Friend,
  FriendRequest,
  PokeDeliveryStatus,
  PokeEvent,
  PokePushPayload,
  Device,
  TestPushDeviceResult,
  TestPushAck,
  TestPushStatus,
  TestPushPayload,
  ApiToken,
  ApiTokenCreated,
  Error: ApiError,
} as const;
