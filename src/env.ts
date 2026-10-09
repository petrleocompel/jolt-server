import { z } from "zod";
import { parseBooleanish } from "#/lib/booleanish";
import { parseIdentityKey } from "#/push/relay-identity";
import { resolvePushRouting } from "#/push/routing";
import "#/lib/zod-locale";

/**
 * Server-only environment. Never import this from a component that ships to
 * the browser — parsing happens at module load and would leak variable names
 * into the client bundle.
 */
function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * An optional yes/no variable. Unset and empty (`VAR=` in a .env file) both
 * mean "not set"; anything else must read as a boolean or the server refuses
 * to start — a typo here must not silently pick a side.
 */
const optionalBooleanish = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (raw === undefined || raw.trim() === "") return undefined;
    const parsed = parseBooleanish(raw);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "must be true/false, 1/0, yes/no or on/off" });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * An optional string where `VAR=` in a .env file means "not set", so the
 * validator after it never sees an empty value.
 */
function optionalNonEmpty<T extends z.ZodType<unknown, string>>(schema: T) {
  return z
    .string()
    .optional()
    .transform((raw) => (raw === undefined || raw.trim() === "" ? undefined : raw.trim()))
    .pipe(schema.optional());
}

/**
 * The public Jolt push relay, used when `PUSH_RELAY_URL` is not set. There is
 * no public relay yet, so there is no default: a server without APNs
 * credentials or a relay URL logs pushes instead of sending them. When the
 * relay has its domain, this is the one line to change.
 */
export const DEFAULT_PUSH_RELAY_URL: string | undefined = undefined;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.url(),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().default("http://127.0.0.1:3000"),
  /**
   * Extra origins browsers may sign in from, comma-separated. Better Auth
   * rejects a sign-in from any origin it does not trust, so a deployment
   * reached under a second name (a LAN IP, a `www.` alias) needs that name
   * listed here or logging in there fails as if the password were wrong.
   */
  TRUSTED_ORIGINS: z.string().optional(),

  // APNs. Absent in dev/test — the push sender falls back to a console stub,
  // so the whole app runs end-to-end without Apple credentials.
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().default("cz.peelco.jolt"),
  APNS_KEY_P8: z.string().optional(),
  APNS_ENV: z.enum(["sandbox", "production"]).default("sandbox"),

  /**
   * The push relay (see docs/self-hosting/push-notifications): lets this
   * server push to the official app builds without Apple credentials of its
   * own. Unset `PUSH_RELAY_ENABLED` uses it whenever there are no APNs
   * credentials and a relay URL is known; `true` prefers it even when there
   * are, `false` never contacts it.
   */
  PUSH_RELAY_URL: optionalNonEmpty(z.url({ protocol: /^https?$/ })),
  PUSH_RELAY_ENABLED: optionalBooleanish,
  /**
   * This server's Ed25519 identity at the relay, as a PEM or a base64 seed.
   * Unset: one is generated on first use and kept in the database, which is
   * what almost everyone wants — set it only to keep the same identity
   * across a database you rebuild from scratch.
   */
  PUSH_RELAY_PRIVATE_KEY: optionalNonEmpty(
    z.string().refine(
      (raw) => {
        try {
          parseIdentityKey(raw);
          return true;
        } catch {
          return false;
        }
      },
      // A key that does not parse must stop the server, not quietly become
      // a different one with every device registered to the old id.
      { message: "must be an Ed25519 PEM key or a base64 32-byte seed" },
    ),
  ),
  /**
   * Seals the generated relay identity in the database, so a dump of it
   * alone cannot sign as this server. Deliberately not BETTER_AUTH_SECRET:
   * rotating that must not change the serverId. Required in production when
   * the relay is used and PUSH_RELAY_PRIVATE_KEY is not set; never rotated,
   * since another value cannot open the stored identity.
   */
  PUSH_RELAY_IDENTITY_SECRET: optionalNonEmpty(z.string().min(32)),
  /** Opt-in: shown to the relay operator. Never sent unless set. */
  PUSH_RELAY_SERVER_NAME: optionalNonEmpty(z.string().max(80)),
  /** Opt-in: this server's public URL, for the relay operator. Never sent unless set. */
  PUSH_RELAY_PUBLIC_URL: optionalNonEmpty(z.url({ protocol: /^https$/ })),

  /** Reported to the relay at registration. Set by the image build. */
  JOLT_SERVER_VERSION: optionalNonEmpty(z.string().max(64)),

  /**
   * IANA zone the send time in notification text is rendered in. Alert bodies
   * are built on the server, so there is no recipient locale to use — the
   * zone name is printed alongside the time, and clients that want local time
   * have the raw `sentAt` in the payload.
   */
  PUSH_TIME_ZONE: z
    .string()
    .default("UTC")
    .refine(isTimeZone, { message: "must be an IANA time zone, e.g. Europe/Prague" }),

  SENTRY_DSN: z.string().optional(),

  /**
   * Whether a friend's automation (a personal access token) may poke you
   * before you have said yes. Unset: an admin decides at /admin/settings.
   * Set: it wins, and the admin page shows it as locked — see
   * src/services/settings.ts.
   */
  AUTOMATION_CONSENT_REQUIRED: optionalBooleanish,

  // Retention windows for the cron worker.
  POKE_EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  FRIEND_REQUEST_EXPIRY_DAYS: z.coerce.number().int().positive().default(30),

  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  ADMIN_NAME: z.string().optional(),
  ADMIN_HANDLE: z.string().optional(),
});

export const env = envSchema.parse(process.env);

/** True when real Apple credentials are configured. */
export const hasApnsCredentials =
  Boolean(env.APNS_KEY_ID) && Boolean(env.APNS_TEAM_ID) && Boolean(env.APNS_KEY_P8);

export const pushRouting = resolvePushRouting({
  hasApnsCredentials,
  relayEnabled: env.PUSH_RELAY_ENABLED,
  relayUrl: env.PUSH_RELAY_URL ?? DEFAULT_PUSH_RELAY_URL,
});

if (
  env.NODE_ENV === "production" &&
  pushRouting.relayUrl !== undefined &&
  !env.PUSH_RELAY_PRIVATE_KEY &&
  !env.PUSH_RELAY_IDENTITY_SECRET
) {
  // The generated identity would otherwise sit in the database as plaintext,
  // and anyone with a backup could sign as this server at the relay.
  throw new Error(
    "The push relay needs PUSH_RELAY_IDENTITY_SECRET (openssl rand -base64 48) " +
      "or PUSH_RELAY_PRIVATE_KEY in production. An identity already stored is sealed " +
      "with the secret on the next start and keeps its serverId.",
  );
}

if (env.PUSH_RELAY_ENABLED === true && pushRouting.relayUrl === undefined) {
  // Asked for the relay and told nowhere to find it: refuse to start rather
  // than run with every push silently going to the console.
  throw new Error("PUSH_RELAY_ENABLED is true but PUSH_RELAY_URL is not set.");
}
