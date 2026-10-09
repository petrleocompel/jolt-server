import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Startup checks that depend on more than one variable. `#/env` parses
 * `process.env` when it is first imported, so each case imports it afresh.
 */

const base = {
  DATABASE_URL: "postgres://jolt:jolt@127.0.0.1:5432/jolt",
  BETTER_AUTH_SECRET: "b".repeat(48),
  NODE_ENV: "production",
  PUSH_RELAY_URL: "https://relay.example/",
  PUSH_RELAY_ENABLED: "",
  PUSH_RELAY_PRIVATE_KEY: "",
  PUSH_RELAY_IDENTITY_SECRET: "",
  APNS_KEY_ID: "",
  APNS_TEAM_ID: "",
  APNS_KEY_P8: "",
};

async function loadEnv(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries({ ...base, ...overrides })) vi.stubEnv(name, value);
  return import("#/env");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("relay identity in production", () => {
  it("refuses to start without a way to keep the identity out of the database in plaintext", async () => {
    await expect(loadEnv({})).rejects.toThrow(/PUSH_RELAY_IDENTITY_SECRET/);
  });

  it("starts with PUSH_RELAY_IDENTITY_SECRET", async () => {
    const { pushRouting } = await loadEnv({ PUSH_RELAY_IDENTITY_SECRET: "i".repeat(48) });
    expect(pushRouting.transport).toBe("relay");
  });

  it("starts with PUSH_RELAY_PRIVATE_KEY, which is never stored", async () => {
    const seed = Buffer.alloc(32, 1).toString("base64");
    await expect(loadEnv({ PUSH_RELAY_PRIVATE_KEY: seed })).resolves.toBeDefined();
  });

  it("asks nothing of a server that never contacts the relay", async () => {
    await expect(loadEnv({ PUSH_RELAY_URL: "" })).resolves.toBeDefined();
    await expect(loadEnv({ PUSH_RELAY_ENABLED: "false" })).resolves.toBeDefined();
  });

  it("asks nothing outside production", async () => {
    await expect(loadEnv({ NODE_ENV: "development" })).resolves.toBeDefined();
  });
});
