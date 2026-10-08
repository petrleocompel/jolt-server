import { describe, expect, it } from "vitest";
import {
  AckBody,
  CreateApiTokenBody,
  PokeDeliveryStatus,
  SelfStimulusBody,
  SendFriendRequestBody,
  SendPokeBody,
  SignupBody,
  StimulusConfig,
  TestPushBody,
} from "#/api/schemas";

describe("StimulusConfig", () => {
  it("accepts an in-range stimulus", () => {
    expect(
      StimulusConfig.safeParse({ kind: "zap", intensity: 30, repetitions: 1 }).success,
    ).toBe(true);
  });

  it.each([
    { kind: "zap", intensity: 101, repetitions: 1 },
    { kind: "zap", intensity: -1, repetitions: 1 },
    { kind: "zap", intensity: 30, repetitions: 6 },
    { kind: "zap", intensity: 30, repetitions: 0 },
    { kind: "shock", intensity: 30, repetitions: 1 },
  ])("rejects %j", (input) => {
    expect(StimulusConfig.safeParse(input).success).toBe(false);
  });
});

describe("SendFriendRequestBody", () => {
  it("accepts exactly one identifier", () => {
    expect(SendFriendRequestBody.safeParse({ handle: "alice" }).success).toBe(true);
    expect(SendFriendRequestBody.safeParse({ inviteCode: "JOLT-ABCD-1234" }).success).toBe(true);
  });

  it("rejects both or neither — there is no discovery endpoint", () => {
    expect(
      SendFriendRequestBody.safeParse({ handle: "alice", inviteCode: "JOLT-ABCD-1234" }).success,
    ).toBe(false);
    expect(SendFriendRequestBody.safeParse({}).success).toBe(false);
  });
});

describe("PokeDeliveryStatus", () => {
  it("includes the server-assigned pending state", () => {
    expect(PokeDeliveryStatus.options).toContain("pending");
  });

  it("does not let a device ack a poke back to pending", () => {
    expect(AckBody.safeParse({ status: "pending" }).success).toBe(false);
    expect(AckBody.safeParse({ status: "fired" }).success).toBe(true);
  });
});

describe("SignupBody", () => {
  it("enforces the handle pattern from the contract", () => {
    const base = { email: "a@b.co", password: "longenough", displayName: "A" };
    expect(SignupBody.safeParse({ ...base, handle: "alice" }).success).toBe(true);
    expect(SignupBody.safeParse({ ...base, handle: "Alice" }).success).toBe(false);
  });

  it("requires an 8-character password", () => {
    const base = { email: "a@b.co", handle: "alice", displayName: "A" };
    expect(SignupBody.safeParse({ ...base, password: "short" }).success).toBe(false);
  });
});

describe("SelfStimulusBody", () => {
  const stimulus = { kind: "zap", intensity: 30, repetitions: 2 };

  it("accepts a stimulus on its own", () => {
    expect(SelfStimulusBody.safeParse({ stimulus }).success).toBe(true);
  });

  /**
   * The bug this pins down: `/me/stimulus` fires at the *caller*, and its
   * body differs from `POST /pokes` by one field. Zod strips unknown keys by
   * default, so a poke body sent here used to lose its `friendId` and return
   * 201 for a stimulus fired at the sender — a poke meant for a friend,
   * delivered to the person who sent it.
   */
  it("rejects a poke body instead of quietly poking the caller", () => {
    const result = SelfStimulusBody.safeParse({
      friendId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      stimulus,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("friendId");
  });

  it("still routes a real poke to /pokes, which requires the friend", () => {
    expect(SendPokeBody.safeParse({ stimulus }).success).toBe(false);
  });
});

describe("TestPushBody", () => {
  it("accepts an empty body — every field is optional", () => {
    expect(TestPushBody.safeParse({}).success).toBe(true);
  });

  // Same reasoning as SelfStimulusBody: this endpoint also fires at the
  // caller's own devices, and with both fields optional an unknown key would
  // otherwise sail through unnoticed.
  it("rejects an unknown field", () => {
    expect(TestPushBody.safeParse({ friendId: "someone-else" }).success).toBe(false);
  });
});

describe("CreateApiTokenBody", () => {
  const FRIEND = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("requires at least one known scope", () => {
    expect(CreateApiTokenBody.safeParse({ name: "ci" }).success).toBe(false);
    expect(CreateApiTokenBody.safeParse({ name: "ci", scopes: [] }).success).toBe(false);
    expect(CreateApiTokenBody.safeParse({ name: "ci", scopes: ["admin"] }).success).toBe(false);
    expect(CreateApiTokenBody.safeParse({ name: "ci", scopes: ["*"] }).success).toBe(true);
  });

  it("keeps an empty friend list distinct from no list at all", () => {
    // Present-but-empty is a token that reaches nobody; absent reaches all.
    const none = CreateApiTokenBody.parse({ name: "ci", scopes: ["pokes:send"], friendIds: [] });
    const all = CreateApiTokenBody.parse({ name: "ci", scopes: ["pokes:send"] });
    expect(none.friendIds).toEqual([]);
    expect(all.friendIds).toBeUndefined();
  });

  it("lowercases friend ids, which are stored lowercase", () => {
    const body = CreateApiTokenBody.parse({
      name: "ci",
      scopes: ["pokes:send"],
      friendIds: [FRIEND.toUpperCase()],
    });
    expect(body.friendIds).toEqual([FRIEND]);
  });

  /**
   * A misspelt `friendIds` stripped by Zod's default would mint a token that
   * reaches every friend instead of the one it named.
   */
  it("rejects an unknown field instead of minting a wider token", () => {
    const result = CreateApiTokenBody.safeParse({
      name: "ci",
      scopes: ["pokes:send"],
      friendIDs: [FRIEND],
    });
    expect(result.success).toBe(false);
  });
});
