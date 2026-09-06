import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { StimulusConfig } from "#/api/schemas";
import { requireUserOrRedirect } from "#/server/session.server";
import { listDevices } from "#/services/devices";
import { sendTestPush, testPushStatus } from "#/services/push-test";

/**
 * The web half of "test my notifications" — /dashboard/devices. Deliberately
 * thin wrappers over the same services the REST API calls, so the app and the
 * dashboard can never drift into testing two different things.
 */

export const fetchMyDevices = createServerFn({ method: "GET" }).handler(async () =>
  listDevices((await requireUserOrRedirect()).id),
);

export const sendMyTestPush = createServerFn({ method: "POST" })
  .validator(
    z.object({
      deviceId: z.uuid().optional(),
      stimulus: StimulusConfig.optional(),
    }),
  )
  .handler(async ({ data }) =>
    sendTestPush({
      userId: (await requireUserOrRedirect()).id,
      deviceId: data.deviceId,
      stimulus: data.stimulus,
      source: "web",
    }),
  );

export const fetchTestPushStatus = createServerFn({ method: "GET" })
  .validator(z.object({ testID: z.uuid() }))
  .handler(async ({ data }) =>
    testPushStatus((await requireUserOrRedirect()).id, data.testID),
  );
