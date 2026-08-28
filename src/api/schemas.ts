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
});

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
  friendId: z.uuid(),
  stimulus: StimulusConfig,
});

export const AckBody = z.object({ status: AckableStatus });

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
  Error: ApiError,
} as const;
