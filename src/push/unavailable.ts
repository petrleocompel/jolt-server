import type {
  PokePushPayload,
  PushResult,
  PushSender,
  PushTarget,
  TestPushPayload,
} from "#/push/types";

/**
 * A transport this server cannot deliver: APNs without credentials, or the
 * relay without a URL, while another transport *is* configured. Unlike the
 * console stub, it never reports success — a test that only logged would
 * otherwise look like the preferred provider accepted the push.
 */
export class UnavailablePushSender implements PushSender {
  constructor(private readonly detail: string) {}

  async sendPoke(targets: Array<PushTarget>, _payload: PokePushPayload): Promise<Array<PushResult>> {
    return this.reject(targets);
  }

  async sendTest(
    targets: Array<PushTarget>,
    _payload: Omit<TestPushPayload, "deviceID">,
  ): Promise<Array<PushResult>> {
    return this.reject(targets);
  }

  async close(): Promise<void> {}

  private reject(targets: Array<PushTarget>): Array<PushResult> {
    return targets.map((target) => ({
      targetId: target.id,
      ok: false,
      reason: "rejected" as const,
      detail: this.detail,
    }));
  }
}
