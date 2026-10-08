import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SendFriendRequestBody, StimulusKind, StimulusPermissionUpdate } from "#/api/schemas";
import {
  acceptRequest,
  listFriends,
  listRequests,
  rejectRequest,
  sendRequest,
  setPermission,
  unfriend,
} from "#/services/friends";
import { requireUserOrRedirect } from "#/server/session.server";
import { serverPolicies } from "#/services/settings";

export const fetchFriends = createServerFn({ method: "GET" }).handler(async () =>
  listFriends((await requireUserOrRedirect()).id),
);

/** What a null automation answer currently means — /dashboard/permissions says so. */
export const fetchServerPolicies = createServerFn({ method: "GET" }).handler(async () => {
  await requireUserOrRedirect();
  return serverPolicies();
});

export const fetchRequests = createServerFn({ method: "GET" }).handler(async () =>
  listRequests((await requireUserOrRedirect()).id),
);

export const submitFriendRequest = createServerFn({ method: "POST" })
  .validator(SendFriendRequestBody)
  .handler(async ({ data }) => sendRequest((await requireUserOrRedirect()).id, data));

export const acceptFriendRequest = createServerFn({ method: "POST" })
  .validator(z.object({ requestId: z.uuid() }))
  .handler(async ({ data }) => acceptRequest((await requireUserOrRedirect()).id, data.requestId));

export const rejectFriendRequest = createServerFn({ method: "POST" })
  .validator(z.object({ requestId: z.uuid() }))
  .handler(async ({ data }) => {
    await rejectRequest((await requireUserOrRedirect()).id, data.requestId);
    return { ok: true };
  });

export const removeFriend = createServerFn({ method: "POST" })
  .validator(z.object({ friendId: z.uuid() }))
  .handler(async ({ data }) => {
    await unfriend((await requireUserOrRedirect()).id, data.friendId);
    return { ok: true };
  });

export const updatePermission = createServerFn({ method: "POST" })
  .validator(
    z.object({
      friendId: z.uuid(),
      kind: StimulusKind,
      permission: StimulusPermissionUpdate,
    }),
  )
  .handler(async ({ data }) =>
    setPermission(
      (await requireUserOrRedirect()).id,
      data.friendId,
      data.kind,
      data.permission,
    ),
  );
