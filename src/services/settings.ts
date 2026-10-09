import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { serverSetting } from "#/db/schema";
import { env } from "#/env";
import type { ServerPolicies } from "#/api/schemas";

/**
 * Server-wide settings: an environment variable if the operator set one,
 * otherwise whatever an admin chose at /admin/settings, otherwise a default.
 *
 * The environment wins outright, and the admin page says so: a self-hoster
 * who pins a value in their compose file must not have it quietly changed
 * from a web page. Not cached — this is one primary-key lookup, and an
 * admin's change has to reach every instance at once, not when a cache on
 * each of them happens to expire.
 */

export type SettingSource = "env" | "admin" | "default";

export interface ResolvedSetting<T> {
  value: T;
  source: SettingSource;
}

/** The precedence rule on its own: environment, then admin, then default. */
export function resolveSetting<T>(
  fromEnv: T | undefined,
  stored: T | undefined,
  fallback: T,
): ResolvedSetting<T> {
  if (fromEnv !== undefined) return { value: fromEnv, source: "env" };
  if (stored !== undefined) return { value: stored, source: "admin" };
  return { value: fallback, source: "default" };
}

const AUTOMATION_CONSENT_KEY = "automation_consent_required";

/**
 * Whether automated pokes need the recipient's explicit yes. `false` by
 * default: a friend who allows you a stimulus allows your scripts too, until
 * they turn automations off for you.
 */
export async function automationConsentPolicy(): Promise<ResolvedSetting<boolean>> {
  const [row] = await db
    .select({ value: serverSetting.value })
    .from(serverSetting)
    .where(eq(serverSetting.key, AUTOMATION_CONSENT_KEY))
    .limit(1);
  // A row that does not hold a boolean (hand-edited, or written by a future
  // version) counts as unset rather than as whatever it is truthy as.
  const stored = z.boolean().safeParse(row?.value);
  if (row && !stored.success) {
    console.warn(`[settings] ignoring non-boolean ${AUTOMATION_CONSENT_KEY}`, row.value);
  }
  return resolveSetting(
    env.AUTOMATION_CONSENT_REQUIRED,
    stored.success ? stored.data : undefined,
    false,
  );
}

/** Admin change. Refused while the environment variable pins the value. */
export async function setAutomationConsentRequired(
  value: boolean,
  adminId: string,
): Promise<ResolvedSetting<boolean>> {
  if (env.AUTOMATION_CONSENT_REQUIRED !== undefined) {
    throw new Error(
      "Locked by the AUTOMATION_CONSENT_REQUIRED environment variable — change it there.",
    );
  }
  await db
    .insert(serverSetting)
    .values({ key: AUTOMATION_CONSENT_KEY, value, updatedBy: adminId })
    .onConflictDoUpdate({
      target: serverSetting.key,
      set: { value, updatedBy: adminId, updatedAt: sql`now()` },
    });
  console.log(`[settings] ${AUTOMATION_CONSENT_KEY} set to ${value} by ${adminId}`);
  return automationConsentPolicy();
}

/**
 * Whether automated pokes may land, for one grant. An explicit answer always
 * wins; no answer follows the policy — allowed unless consent is required.
 */
export function effectiveAutomationAllowed(
  explicit: boolean | null,
  consentRequired: boolean,
): boolean {
  return explicit ?? !consentRequired;
}

/** The policies `Me.policies` reports, resolved now. */
export async function serverPolicies(): Promise<ServerPolicies> {
  return { automationConsentRequired: (await automationConsentPolicy()).value };
}

const RELAY_IDENTITY_KEY = "relay_identity";

const StoredRelayIdentity = z.object({ seed: z.string() });

/**
 * This server's Ed25519 seed for the push relay (see
 * src/push/relay-identity.ts), generated on first use and kept here for
 * good. Not something an admin edits, and deliberately not sealed with
 * BETTER_AUTH_SECRET: the serverId is derived from it, and rotating the
 * auth secret must not turn the server into a stranger at the relay.
 *
 * Two instances starting at once may both generate one; the first insert
 * wins and both read it back, so they agree on who they are.
 */
export async function relayIdentitySeed(generate: () => string): Promise<string> {
  const read = async () => {
    const [row] = await db
      .select({ value: serverSetting.value })
      .from(serverSetting)
      .where(eq(serverSetting.key, RELAY_IDENTITY_KEY))
      .limit(1);
    if (!row) return null;
    const stored = StoredRelayIdentity.safeParse(row.value);
    // Never replaced when unreadable: a new key is a new serverId, and every
    // device registered with the relay for the old one would go quiet.
    if (!stored.success) throw new Error(`[settings] ${RELAY_IDENTITY_KEY} is unreadable`);
    return stored.data.seed;
  };

  const existing = await read();
  if (existing) return existing;

  await db
    .insert(serverSetting)
    .values({ key: RELAY_IDENTITY_KEY, value: { seed: generate(), createdAt: new Date().toISOString() } })
    .onConflictDoNothing({ target: serverSetting.key });
  const stored = await read();
  if (!stored) throw new Error(`[settings] could not store ${RELAY_IDENTITY_KEY}`);
  return stored;
}
