import { ApnsPushSender } from "#/push/apns";
import { ConsolePushSender } from "#/push/console";
import { base64url, fromBase64url } from "#/push/envelope";
import { RelayPushSender } from "#/push/relay";
import {
  RelayClient,
  generateIdentitySeed,
  identityFromSeed,
  parseIdentityKey,
} from "#/push/relay-identity";
import { RoutingPushSender } from "#/push/routing";
import type { PushSender } from "#/push/types";
import { ApiError } from "#/api/errors";
import type { PushConfig } from "#/api/schemas";
import { env, hasApnsCredentials, pushRouting } from "#/env";
import { relayIdentitySeed } from "#/services/settings";

let sender: PushSender | null = null;
let relay: RelayClient | null | undefined;

/**
 * The relay client, or null when this server does not use the relay. Shared
 * process-wide so registration happens once and the admin overview sees the
 * same state the sender does.
 */
export function relayClient(): RelayClient | null {
  if (relay !== undefined) return relay;
  relay = pushRouting.relayUrl
    ? new RelayClient({
        url: pushRouting.relayUrl,
        loadIdentity: async () =>
          env.PUSH_RELAY_PRIVATE_KEY
            ? parseIdentityKey(env.PUSH_RELAY_PRIVATE_KEY)
            : identityFromSeed(
                fromBase64url(await relayIdentitySeed(() => base64url(generateIdentitySeed()))),
              ),
        version: env.JOLT_SERVER_VERSION ?? "dev",
        // Opt-in, both of them: the relay learns a server's name and address
        // only from an operator who chose to tell it.
        name: env.PUSH_RELAY_SERVER_NAME,
        publicUrl: env.PUSH_RELAY_PUBLIC_URL,
      })
    : null;
  return relay;
}

/**
 * Real APNs for devices registered directly when credentials are present,
 * the relay for devices registered there when it is configured, the console
 * stub for anything this server cannot deliver. Resolved lazily and cached
 * so the HTTP/2 session to Apple is shared process-wide.
 */
export function pushSender(): PushSender {
  if (sender) return sender;

  const fallback = new ConsolePushSender(console.log, env.PUSH_TIME_ZONE);
  const client = relayClient();

  if (pushRouting.transport === "none" && env.NODE_ENV === "production") {
    console.warn(
      "[push] neither APNS_* nor PUSH_RELAY_URL is configured in production — pokes will be recorded but never delivered",
    );
  }

  sender = new RoutingPushSender({
    apns: hasApnsCredentials
      ? new ApnsPushSender({
          keyId: env.APNS_KEY_ID!,
          teamId: env.APNS_TEAM_ID!,
          bundleId: env.APNS_BUNDLE_ID,
          keyP8: env.APNS_KEY_P8!,
          environment: env.APNS_ENV,
          timeZone: env.PUSH_TIME_ZONE,
        })
      : fallback,
    relay: client ? new RelayPushSender(client) : fallback,
  });

  return sender;
}

/**
 * `GET /push/config`. For the relay, the server registers itself first: the
 * app's own registration names this server's id, and the relay refuses an id
 * it has never heard of (protocol C2). So a registration that did not
 * succeed — a relay that cannot be reached, a 5xx, or `server_blocked` — is
 * a 503, never `relay`: the app keeps its current registration and asks
 * again later, instead of spending its attempts at the relay on a device
 * registration that cannot succeed.
 */
export async function pushConfig(): Promise<PushConfig> {
  const client = relayClient();
  if (pushRouting.transport === "relay" && client) {
    const identity = await client.getIdentity();
    try {
      await client.ensureRegistered();
    } catch (error) {
      console.warn("[push] relay registration failed", error);
      throw ApiError.unavailable(
        "Push registration is unavailable: the push relay has not accepted this server.",
      );
    }
    return { transport: "relay", relay: { url: pushRouting.relayUrl!, serverId: identity.serverId } };
  }
  if (pushRouting.transport === "apns") {
    return { transport: "apns", apnsEnvironment: env.APNS_ENV };
  }
  return { transport: "none" };
}

/** Test seam: swap in a fake sender. */
export function setPushSender(next: PushSender | null): void {
  sender = next;
}

export * from "#/push/types";
