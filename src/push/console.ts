import type { PokePushPayload, PushResult, PushSender, PushTarget } from "#/push/types";
import { alertTextFor } from "#/push/types";

/**
 * Dev/test default. Logs what would have gone to Apple so the whole poke flow
 * — permission check, cooldown, event row, ack — is exercisable without any
 * Apple credentials. Always reports success.
 */
export class ConsolePushSender implements PushSender {
  constructor(private readonly log: (message: string) => void = console.log) {}

  async sendPoke(
    targets: Array<PushTarget>,
    payload: PokePushPayload,
  ): Promise<Array<PushResult>> {
    const { title, body } = alertTextFor(payload);
    const { kind, intensity, repetitions } = payload.stimulus;

    this.log(
      `[push] poke ${payload.pokeID} — "${title}: ${body}" ` +
        `(${kind} ${intensity}% x${repetitions}) -> ${targets.length} device(s); ` +
        `would send 1 alert + 1 background push each`,
    );
    for (const target of targets) {
      this.log(`[push]   device ${target.id} token ${target.token.slice(0, 12)}…`);
    }

    return targets.map((target) => ({ targetId: target.id, ok: true }));
  }

  async close(): Promise<void> {}
}
