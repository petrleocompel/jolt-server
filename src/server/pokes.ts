import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { StimulusConfig } from "#/api/schemas";
import { listPokes, sendPoke } from "#/services/pokes";
import { requireUserOrRedirect } from "#/server/session.server";

export const fetchActivity = createServerFn({ method: "GET" })
  .validator(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
  .handler(async ({ data }) =>
    listPokes((await requireUserOrRedirect()).id, { limit: data?.limit ?? 50 }),
  );

export const submitPoke = createServerFn({ method: "POST" })
  .validator(z.object({ friendId: z.uuid(), stimulus: StimulusConfig }))
  .handler(async ({ data }) =>
    (await sendPoke((await requireUserOrRedirect()).id, data.friendId, data.stimulus)).event,
  );
