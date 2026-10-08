import { describe, expect, it } from "vitest";
import { presentPokeEvent } from "#/api/present";
import type { PokeEvent as PokeEventRow } from "#/db/schema";

/**
 * Who learns what about an automated poke: both sides see that it was
 * automated; only the sender sees which of their tokens did it.
 */

const ALICE = "6f1c1a52-6f0e-4c39-9d6c-6a0e8c1f0a01";
const BOB = "6f1c1a52-6f0e-4c39-9d6c-6a0e8c1f0a02";
const TOKEN = "0b6c7c55-5d2b-4d3e-9a51-0e7c3c3f7e10";

function row(overrides: Partial<PokeEventRow> = {}): PokeEventRow {
  return {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    senderId: ALICE,
    recipientId: BOB,
    kind: "vibe",
    intensity: 20,
    repetitions: 1,
    status: "pending",
    createdAt: new Date("2026-10-08T12:00:00.000Z"),
    ackedAt: null,
    source: "api_token",
    apiTokenId: TOKEN,
    ...overrides,
  };
}

const alice = { handle: "alice", name: "Alice" };
const bob = { handle: "bob", name: "Bob" };

describe("presentPokeEvent", () => {
  it("shows the sender which of their tokens sent it", () => {
    const event = presentPokeEvent(row(), ALICE, bob, "home assistant");
    expect(event).toMatchObject({
      direction: "sent",
      viaApiToken: true,
      apiTokenName: "home assistant",
    });
  });

  it("tells the recipient it was automated, but not what the script is called", () => {
    const event = presentPokeEvent(row(), BOB, alice, "home assistant");
    expect(event).toMatchObject({ direction: "received", viaApiToken: true, apiTokenName: null });
  });

  it("still marks a poke from a since-revoked token as automated", () => {
    // Revoking nulls `api_token_id`; `source` is what remembers.
    const event = presentPokeEvent(row({ apiTokenId: null }), ALICE, bob, null);
    expect(event).toMatchObject({ viaApiToken: true, apiTokenName: null });
  });

  it("marks a poke sent in person as such, with both keys present", () => {
    const event = presentPokeEvent(row({ source: "app", apiTokenId: null }), ALICE, bob);
    expect(event.viaApiToken).toBe(false);
    // Present and null, not absent: clients decode it as a required key.
    expect(event).toHaveProperty("apiTokenName", null);
  });

  it("shows a self-stimulus's token to its sender, who is also its recipient", () => {
    const event = presentPokeEvent(row({ recipientId: ALICE }), ALICE, alice, "ci");
    expect(event.apiTokenName).toBe("ci");
  });
});
