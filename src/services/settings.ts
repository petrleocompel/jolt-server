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
