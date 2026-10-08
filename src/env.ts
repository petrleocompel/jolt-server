import { z } from "zod";
import { parseBooleanish } from "#/lib/booleanish";
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
