import { describe, expect, it } from "vitest";
import {
  AckBody,
  PokeDeliveryStatus,
  SendFriendRequestBody,
  SignupBody,
  StimulusConfig,
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
