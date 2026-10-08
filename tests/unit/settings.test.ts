import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBooleanish } from "#/lib/booleanish";

/**
 * Where the automation-consent policy comes from — environment, then admin,
 * then default — and how a grant's answer combines with it.
 */

const mocked = vi.hoisted(() => ({
  env: { AUTOMATION_CONSENT_REQUIRED: undefined as boolean | undefined },
  stored: [] as Array<{ value: unknown }>,
  writes: [] as Array<unknown>,
}));

vi.mock("#/env", () => ({ env: mocked.env }));
vi.mock("#/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => mocked.stored }) }) }),
    insert: () => ({
      values: (row: unknown) => ({
        onConflictDoUpdate: async () => {
          mocked.writes.push(row);
          mocked.stored = [{ value: (row as { value: unknown }).value }];
        },
      }),
    }),
  },
}));

const { automationConsentPolicy, effectiveAutomationAllowed, resolveSetting, setAutomationConsentRequired } =
  await import("#/services/settings");

beforeEach(() => {
  mocked.env.AUTOMATION_CONSENT_REQUIRED = undefined;
  mocked.stored = [];
  mocked.writes = [];
});

describe("parseBooleanish", () => {
  it.each([
    ["true", true],
    ["TRUE", true],
    [" 1 ", true],
    ["yes", true],
    ["on", true],
    ["false", false],
    ["0", false],
    ["no", false],
    ["Off", false],
  ])("reads %j as %s", (raw, expected) => {
    expect(parseBooleanish(raw)).toBe(expected);
  });

  it("refuses to guess at anything else", () => {
    expect(parseBooleanish("maybe")).toBeNull();
    expect(parseBooleanish("2")).toBeNull();
  });
});

describe("AUTOMATION_CONSENT_REQUIRED in the environment", () => {
  const base = {
    DATABASE_URL: "postgres://jolt:jolt@127.0.0.1:5432/jolt",
    BETTER_AUTH_SECRET: "x".repeat(32),
  };

  async function loadEnv(value: string | undefined) {
    vi.resetModules();
    vi.doUnmock("#/env");
    for (const [key, v] of Object.entries(base)) vi.stubEnv(key, v);
    if (value === undefined) delete process.env.AUTOMATION_CONSENT_REQUIRED;
    else vi.stubEnv("AUTOMATION_CONSENT_REQUIRED", value);
    return (await import("#/env")).env;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doMock("#/env", () => ({ env: mocked.env }));
  });

  // The bug `z.coerce.boolean()` would have shipped: Boolean("false") is true.
  it('reads "false" as false', async () => {
    expect((await loadEnv("false")).AUTOMATION_CONSENT_REQUIRED).toBe(false);
    expect((await loadEnv("0")).AUTOMATION_CONSENT_REQUIRED).toBe(false);
    expect((await loadEnv("true")).AUTOMATION_CONSENT_REQUIRED).toBe(true);
  });

  it("treats unset and empty alike — not set, so the admin decides", async () => {
    expect((await loadEnv(undefined)).AUTOMATION_CONSENT_REQUIRED).toBeUndefined();
    expect((await loadEnv("")).AUTOMATION_CONSENT_REQUIRED).toBeUndefined();
  });

  it("refuses to start on a value it cannot read", async () => {
    await expect(loadEnv("maybe")).rejects.toThrow(/AUTOMATION_CONSENT_REQUIRED/);
  });
});

describe("resolveSetting", () => {
  it("prefers the environment, then the admin's choice, then the default", () => {
    expect(resolveSetting(true, false, false)).toEqual({ value: true, source: "env" });
    // An explicit `false` from the environment is still the environment.
    expect(resolveSetting(false, true, true)).toEqual({ value: false, source: "env" });
    expect(resolveSetting(undefined, true, false)).toEqual({ value: true, source: "admin" });
    expect(resolveSetting(undefined, undefined, false)).toEqual({ value: false, source: "default" });
  });
});

describe("automationConsentPolicy", () => {
  it("defaults to not required", async () => {
    expect(await automationConsentPolicy()).toEqual({ value: false, source: "default" });
  });

  it("follows the admin when the environment is silent", async () => {
    mocked.stored = [{ value: true }];
    expect(await automationConsentPolicy()).toEqual({ value: true, source: "admin" });
  });

  it("lets the environment override the admin", async () => {
    mocked.stored = [{ value: true }];
    mocked.env.AUTOMATION_CONSENT_REQUIRED = false;
    expect(await automationConsentPolicy()).toEqual({ value: false, source: "env" });
  });

  it("ignores a stored value that is not a boolean instead of reading it as truthy", async () => {
    mocked.stored = [{ value: "false" }];
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await automationConsentPolicy()).toEqual({ value: false, source: "default" });
    quiet.mockRestore();
  });
});

describe("setAutomationConsentRequired", () => {
  it("records the admin's choice", async () => {
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await setAutomationConsentRequired(true, "admin-id")).toEqual({
      value: true,
      source: "admin",
    });
    expect(mocked.writes).toEqual([
      { key: "automation_consent_required", value: true, updatedBy: "admin-id" },
    ]);
    quiet.mockRestore();
  });

  it("refuses while the environment pins the value", async () => {
    mocked.env.AUTOMATION_CONSENT_REQUIRED = false;
    await expect(setAutomationConsentRequired(true, "admin-id")).rejects.toThrow(/environment/);
    expect(mocked.writes).toEqual([]);
  });
});

describe("effectiveAutomationAllowed", () => {
  it("lets automations through by default when consent is not required", () => {
    expect(effectiveAutomationAllowed(null, false)).toBe(true);
  });

  it("blocks them by default when consent is required", () => {
    expect(effectiveAutomationAllowed(null, true)).toBe(false);
  });

  it("always honours an explicit answer, whatever the policy", () => {
    expect(effectiveAutomationAllowed(false, false)).toBe(false);
    expect(effectiveAutomationAllowed(true, true)).toBe(true);
  });
});
