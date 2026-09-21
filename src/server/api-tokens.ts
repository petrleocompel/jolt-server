import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CreateApiTokenBody } from "#/api/schemas";
import { requireUserOrRedirect } from "#/server/session.server";
import { createApiToken, listApiTokens, revokeApiToken } from "#/services/api-tokens";

/**
 * The web half of /dashboard/tokens. Thin wrappers over the same service
 * /api/v1/me/tokens calls, so the page and the API can never drift into
 * minting two different kinds of token.
 *
 * Session-backed by construction — `requireUserOrRedirect` reads the cookie,
 * so a personal access token cannot reach these any more than it can reach
 * the REST endpoints behind them.
 */

export const fetchMyApiTokens = createServerFn({ method: "GET" }).handler(async () =>
  listApiTokens((await requireUserOrRedirect()).id),
);

export const createMyApiToken = createServerFn({ method: "POST" })
  .validator(CreateApiTokenBody)
  .handler(async ({ data }) => createApiToken((await requireUserOrRedirect()).id, data));

export const revokeMyApiToken = createServerFn({ method: "POST" })
  .validator(z.object({ tokenId: z.uuid() }))
  .handler(async ({ data }) => {
    await revokeApiToken((await requireUserOrRedirect()).id, data.tokenId);
  });
