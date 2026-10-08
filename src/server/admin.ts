import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import QRCode from "qrcode";
import { db } from "#/db";
import { deviceToken, friendPermission, pokeEvent, user as userTable } from "#/db/schema";
import { StimulusConfig } from "#/api/schemas";
import { requireAdminOrRedirect, requireUserOrRedirect } from "#/server/session.server";
import { statusBreakdown } from "#/services/pokes";
import { sendTestPush } from "#/services/push-test";
import { hasApnsCredentials } from "#/env";
import { automationConsentPolicy, setAutomationConsentRequired } from "#/services/settings";

/** Route guard for the /admin shell — redirects non-admins away. */
export const assertAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const admin = await requireAdminOrRedirect();
  return { handle: admin.handle };
});

export const fetchAdminOverview = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminOrRedirect();
  const [[users], [devices], [pokes], breakdown] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(userTable),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(deviceToken)
      .where(isNull(deviceToken.disabledAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(pokeEvent),
    statusBreakdown(),
  ]);
  return {
    users: users?.n ?? 0,
    activeDevices: devices?.n ?? 0,
    pokes: pokes?.n ?? 0,
    breakdown,
    apnsConfigured: hasApnsCredentials,
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
  const rows = await db
    .select({
      id: deviceToken.id,
      token: deviceToken.token,
      platform: deviceToken.platform,
      createdAt: deviceToken.createdAt,
      lastSeenAt: deviceToken.lastSeenAt,
      disabledAt: deviceToken.disabledAt,
      handle: userTable.handle,
      userId: deviceToken.userId,
    })
    .from(deviceToken)
    .innerJoin(userTable, eq(userTable.id, deviceToken.userId))
    .orderBy(desc(deviceToken.lastSeenAt))
    .limit(200);
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    disabledAt: r.disabledAt?.toISOString() ?? null,
  }));
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
