import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PushResult, PushTarget } from "#/push/types";

/**
 * The service under test reaches for the database and for Apple. Both are
 * mocked here so the parts worth testing — targeting, the rate limit,
 * ownership, ack idempotency and expiry — run as pure logic.
 */

const targetsFor = vi.fn<(userId: string, deviceId?: string) => Promise<Array<PushTarget>>>();
const markUnregistered = vi.fn<(ids: Array<string>) => Promise<void>>();
const sendTest = vi.fn<() => Promise<Array<PushResult>>>();

vi.mock("#/services/devices", () => ({
  targetsFor: (userId: string, deviceId?: string) => targetsFor(userId, deviceId),
  markUnregistered: (ids: Array<string>) => markUnregistered(ids),
}));

vi.mock("#/push", () => ({ pushSender: () => ({ sendTest }) }));

vi.mock("#/env", () => ({ hasApnsCredentials: true }));

const { ackTestPush, resetPushTestStore, sendTestPush, testPushStatus } = await import(
  "#/services/push-test"
);

const ALICE = "user-alice";
const BOB = "user-bob";

beforeEach(() => {
  vi.useRealTimers();
  resetPushTestStore();
  targetsFor.mockReset();
  markUnregistered.mockReset();
  markUnregistered.mockResolvedValue(undefined);
  sendTest.mockReset();

  targetsFor.mockResolvedValue([
    { id: "device-1", token: "aaa" },
    { id: "device-2", token: "bbb" },
  ]);
  sendTest.mockResolvedValue([
    { targetId: "device-1", ok: true },
    { targetId: "device-2", ok: true },
  ]);
});

describe("sendTestPush", () => {
  it("reports every device APNs was asked about", async () => {
    const status = await sendTestPush({ userId: ALICE, source: "web" });

    expect(status.devices).toEqual([
      { deviceId: "device-1", ok: true, reason: undefined, detail: undefined },
      { deviceId: "device-2", ok: true, reason: undefined, detail: undefined },
    ]);
    expect(status.acks).toEqual([]);
    expect(status.apnsConfigured).toBe(true);
  });

  it("passes the device filter and the stimulus straight through", async () => {
    const stimulus = { kind: "zap", intensity: 30, repetitions: 2 } as const;
    const status = await sendTestPush({
      userId: ALICE,
      deviceId: "device-2",
      stimulus,
      source: "app",
    });

    expect(targetsFor).toHaveBeenCalledWith(ALICE, "device-2");
    expect(sendTest).toHaveBeenCalledWith(expect.anything(), {
      testID: status.testID,
      sentAt: status.sentAt,
      source: "app",
      stimulus,
    });
  });

  it("disables tokens APNs reported unregistered", async () => {
    sendTest.mockResolvedValue([
      { targetId: "device-1", ok: true },
      { targetId: "device-2", ok: false, reason: "unregistered", detail: "Unregistered" },
    ]);

    await sendTestPush({ userId: ALICE, source: "web" });

    expect(markUnregistered).toHaveBeenCalledWith(["device-2"]);
  });

  it("404s rather than silently succeeding when there is nothing to push to", async () => {
    targetsFor.mockResolvedValue([]);

    await expect(sendTestPush({ userId: ALICE, source: "web" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rate limits a second test within the window", async () => {
    await sendTestPush({ userId: ALICE, source: "web" });

    await expect(sendTestPush({ userId: ALICE, source: "web" })).rejects.toMatchObject({
      status: 429,
    });
    // Per account, not global — Bob is unaffected.
    await expect(sendTestPush({ userId: BOB, source: "web" })).resolves.toBeTruthy();
  });

  it("does not consume the rate limit when the send never happened", async () => {
    targetsFor.mockResolvedValueOnce([]);
    await expect(sendTestPush({ userId: ALICE, source: "web" })).rejects.toMatchObject({
      status: 404,
    });

    await expect(sendTestPush({ userId: ALICE, source: "web" })).resolves.toBeTruthy();
  });
});

describe("testPushStatus", () => {
  it("hides a test from anyone but its sender", async () => {
    const { testID } = await sendTestPush({ userId: ALICE, source: "web" });

    expect(testPushStatus(ALICE, testID).testID).toBe(testID);
    expect(() => testPushStatus(BOB, testID)).toThrowError(/No test push/);
  });

  it("forgets a test once it is older than the retention window", async () => {
    const { testID } = await sendTestPush({ userId: ALICE, source: "web" });

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    expect(() => testPushStatus(ALICE, testID)).toThrowError(/expired/);
  });
});

describe("ackTestPush", () => {
  it("records the round trip", async () => {
    const { testID } = await sendTestPush({ userId: ALICE, source: "app" });

    const status = ackTestPush(ALICE, testID, { deviceId: "device-1", path: "alert" });

    expect(status.acks).toHaveLength(1);
    expect(status.acks[0]).toMatchObject({ deviceId: "device-1", path: "alert" });
    expect(status.acks[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps the alert and background confirmations apart", async () => {
    const { testID } = await sendTestPush({ userId: ALICE, source: "app" });

    ackTestPush(ALICE, testID, { deviceId: "device-1", path: "alert" });
    const status = ackTestPush(ALICE, testID, { deviceId: "device-1", path: "background" });

    // Two different iOS entry points saw it — that is two confirmations, not
    // a duplicate.
    expect(status.acks.map((ack) => ack.path)).toEqual(["alert", "background"]);
  });

  it("ignores a repeat ack for the same device and path", async () => {
    const { testID } = await sendTestPush({ userId: ALICE, source: "app" });

    ackTestPush(ALICE, testID, { deviceId: "device-1", path: "alert", status: "fired" });
    const status = ackTestPush(ALICE, testID, { deviceId: "device-1", path: "alert" });

    expect(status.acks).toHaveLength(1);
    // First ack wins, so the status it reported is not lost.
    expect(status.acks[0]!.status).toBe("fired");
  });

  it("attributes acks per device", async () => {
    const { testID } = await sendTestPush({ userId: ALICE, source: "web" });

    ackTestPush(ALICE, testID, { deviceId: "device-1", path: "alert" });
    const status = ackTestPush(ALICE, testID, { deviceId: "device-2", path: "alert" });

    expect(status.acks.map((ack) => ack.deviceId)).toEqual(["device-1", "device-2"]);
  });

  it("rejects an ack for someone else's test", async () => {
    const { testID } = await sendTestPush({ userId: ALICE, source: "web" });

    expect(() => ackTestPush(BOB, testID, { path: "alert" })).toThrowError(/No test push/);
  });
});
