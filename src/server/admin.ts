import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import QRCode from "qrcode";
import { db } from "#/db";
import { deviceToken, friendPermission, pokeEvent, user as userTable } from "#/db/schema";
import { StimulusConfig } from "#/api/schemas";
import { requireAdminOrRedirect, requireUserOrRedirect } from "#/server/session.server";
import { listAllDevices } from "#/services/devices";
import { statusBreakdown } from "#/services/pokes";
import { sendTestPush } from "#/services/push-test";
import { pushRouting } from "#/env";
import { relayClient } from "#/push";
import { automationConsentPolicy, setAutomationConsentRequired } from "#/services/settings";

/** Route guard for the /admin shell — redirects non-admins away. */
export const assertAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const admin = await requireAdminOrRedirect();
  return { handle: admin.handle };
});

/**
 * How this server delivers pushes, for the admin overview. `console` is the
 * stub: pokes are recorded and logged, and reach nobody. The relay's state is
 * what this process has seen — registration happens on first use, so a
 * freshly started server shows `unregistered` until a push or an app asks.
 */
async function pushOverview() {
  const client = relayClient();
  return {
    mode: pushRouting.transport === "none" ? ("console" as const) : pushRouting.transport,
    relay: client ? await client.status() : null,
  };
}

export const fetchAdminOverview = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminOrRedirect();
  const [[users], [devices], [pokes], breakdown, push] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(userTable),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(deviceToken)
      .where(isNull(deviceToken.disabledAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(pokeEvent),
    statusBreakdown(),
    pushOverview(),
  ]);
  return {
    users: users?.n ?? 0,
    activeDevices: devices?.n ?? 0,
    pokes: pokes?.n ?? 0,
    breakdown,
    push,
  };
});

export const fetchAllUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminOrRedirect();
  const rows = await db
    .select({
      id: userTable.id,
      handle: userTable.handle,
      name: userTable.name,
      email: userTable.email,
      role: userTable.role,
      inviteCode: userTable.inviteCode,
      createdAt: userTable.createdAt,
    })
    .from(userTable)
    .orderBy(desc(userTable.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
});

export const fetchAllPokes = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminOrRedirect();
  const sender = alias(userTable, "sender");
  const rows = await db
    .select({
      id: pokeEvent.id,
      kind: pokeEvent.kind,
      intensity: pokeEvent.intensity,
      repetitions: pokeEvent.repetitions,
      status: pokeEvent.status,
      createdAt: pokeEvent.createdAt,
      ackedAt: pokeEvent.ackedAt,
      senderHandle: sender.handle,
      recipientId: pokeEvent.recipientId,
      source: pokeEvent.source,
    })
    .from(pokeEvent)
    .innerJoin(sender, eq(sender.id, pokeEvent.senderId))
    .orderBy(desc(pokeEvent.createdAt))
    .limit(200);
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    ackedAt: r.ackedAt?.toISOString() ?? null,
  }));
});

export const fetchAllDevices = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminOrRedirect();
  return listAllDevices();
});

/**
 * Pushes straight to a user's devices, bypassing friendship and permission
 * checks. Admin-only, and the whole point is diagnosing APNs delivery when
 * the real path reports `pending` forever.
 */
/**
 * Support tool: push to someone else's devices to prove their notifications
 * work. Same service as the user-facing /dashboard/devices test, so there is
 * only one thing to keep working — it just isn't scoped to the caller.
 */
export const sendTestPushToUser = createServerFn({ method: "POST" })
  .validator(
    z.object({ userId: z.string(), stimulus: StimulusConfig.optional() }),
  )
  .handler(async ({ data }) => {
    await requireAdminOrRedirect();
    return sendTestPush({ userId: data.userId, stimulus: data.stimulus, source: "web" });
  });

export const qrForInvite = createServerFn({ method: "GET" }).handler(async () => {
  const me = await requireUserOrRedirect();
  return {
    inviteCode: me.inviteCode,
    handle: me.handle,
    dataUrl: await QRCode.toDataURL(me.inviteCode, { margin: 1, width: 256 }),
  };
});

/**
 * /admin/settings. Besides the setting itself, how many grants would change
 * meaning if consent became required: every allowed (granter, grantee,
 * kind) whose owner never answered the automation question is, today,
 * open to automations — and would stop accepting them the moment the
 * policy flips. Explicit answers are unaffected either way.
 */
export const fetchServerSettings = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminOrRedirect();
  const [policy, [unanswered]] = await Promise.all([
    automationConsentPolicy(),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(friendPermission)
      .where(and(eq(friendPermission.isAllowed, true), isNull(friendPermission.automationAllowed))),
  ]);
  return {
    automationConsentRequired: policy,
    unansweredAllowedGrants: unanswered?.n ?? 0,
  };
});

export const updateAutomationConsentRequired = createServerFn({ method: "POST" })
  .validator(z.object({ required: z.boolean() }))
  .handler(async ({ data }) => {
    const admin = await requireAdminOrRedirect();
    return setAutomationConsentRequired(data.required, admin.id);
  });
