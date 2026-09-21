import { ApnsPushSender } from "#/push/apns";
import { ConsolePushSender } from "#/push/console";
import type { PushSender } from "#/push/types";
import { env, hasApnsCredentials } from "#/env";

let sender: PushSender | null = null;

/**
 * Real APNs when credentials are present, console stub otherwise. Resolved
 * lazily and cached so the HTTP/2 session to Apple is shared process-wide.
 */
export function pushSender(): PushSender {
  if (sender) return sender;

  if (hasApnsCredentials) {
    sender = new ApnsPushSender({
      keyId: env.APNS_KEY_ID!,
      teamId: env.APNS_TEAM_ID!,
      bundleId: env.APNS_BUNDLE_ID,
      keyP8: env.APNS_KEY_P8!,
      environment: env.APNS_ENV,
      timeZone: env.PUSH_TIME_ZONE,
    });
  } else {
    if (env.NODE_ENV === "production") {
      console.warn(
        "[push] APNS_* not configured in production — pokes will be recorded but never delivered",
      );
    }
    sender = new ConsolePushSender(console.log, env.PUSH_TIME_ZONE);
  }

  return sender;
}

/** Test seam: swap in a fake sender. */
export function setPushSender(next: PushSender | null): void {
  sender = next;
}

export * from "#/push/types";
