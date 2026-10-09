import type {
  PokePushPayload,
  PushResult,
  PushSender,
  PushTarget,
  PushTransport,
  TestPushPayload,
} from "#/push/types";

/**
 * Sends each device's push the way that device registered: APNs rows to the
 * direct sender, relay rows to the relay. A user can have both at once —
 * one phone on an old app build, another on a new one — and a server that
 * moves from its own APNs key to the relay keeps delivering to devices that
 * have not re-registered yet.
 *
 * Which sender stands behind each transport is decided by the caller
 * (src/push/index.ts); a transport this server cannot deliver gets the
 * console sender, so its pokes are still recorded and logged.
 */
export class RoutingPushSender implements PushSender {
  constructor(private readonly senders: Record<PushTransport, PushSender>) {}

  sendPoke(targets: Array<PushTarget>, payload: PokePushPayload): Promise<Array<PushResult>> {
    return this.route(targets, (sender, group) => sender.sendPoke(group, payload));
  }

  sendTest(
    targets: Array<PushTarget>,
    payload: Omit<TestPushPayload, "deviceID">,
  ): Promise<Array<PushResult>> {
    return this.route(targets, (sender, group) => sender.sendTest(group, payload));
  }

  async close(): Promise<void> {
    await Promise.all([...new Set(Object.values(this.senders))].map((sender) => sender.close()));
  }

  /** Splits by transport, sends the groups in parallel, answers in the input order. */
  private async route(
    targets: Array<PushTarget>,
    send: (sender: PushSender, group: Array<PushTarget>) => Promise<Array<PushResult>>,
  ): Promise<Array<PushResult>> {
    const groups = new Map<PushSender, Array<PushTarget>>();
    for (const target of targets) {
      const sender = this.senders[target.transport];
      groups.set(sender, [...(groups.get(sender) ?? []), target]);
    }

    const byId = new Map<string, PushResult>();
    await Promise.all(
      [...groups].map(async ([sender, group]) => {
        for (const result of await send(sender, group)) byId.set(result.targetId, result);
      }),
    );

    return targets.map(
      (target) =>
        byId.get(target.id) ?? {
          targetId: target.id,
          ok: false,
          reason: "transient",
          detail: "No result from the sender.",
        },
    );
  }
}

export interface PushRouting {
  /** The relay's base URL, when one is configured and not switched off. */
  relayUrl: string | undefined;
  /**
   * What `GET /push/config` tells the apps to register with. Rows registered
   * the other way keep being delivered their own way until the app
   * re-registers.
   */
  transport: "apns" | "relay" | "none";
}

/**
 * Which way pushes go. Pure, so the precedence is testable without an
 * environment: an explicit `PUSH_RELAY_ENABLED` wins; unset, the relay is
 * the fallback for a server without APNs credentials of its own.
 */
export function resolvePushRouting(options: {
  hasApnsCredentials: boolean;
  relayEnabled: boolean | undefined;
  relayUrl: string | undefined;
}): PushRouting {
  const relayUrl = options.relayEnabled === false ? undefined : options.relayUrl;
  const preferRelay =
    relayUrl !== undefined && (options.relayEnabled === true || !options.hasApnsCredentials);
  return {
    relayUrl,
    transport: preferRelay ? "relay" : options.hasApnsCredentials ? "apns" : "none",
  };
}
