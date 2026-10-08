import { describe, expect, it, vi } from "vitest";
import { StimulusPermission, StimulusPermissionUpdate } from "#/api/schemas";

/**
 * The automation-consent half of a permission: what a PUT writes, and what
 * the API reports back under each server policy.
 */

vi.mock("#/db", () => ({ db: {} }));
vi.mock("#/env", () => ({ env: {} }));

const { emptyPermissionSet, permissionWrite, presentPermission } = await import(
  "#/services/friends"
);

const grant = { isAllowed: true, maxIntensity: 40, cooldownSeconds: 5 };

describe("StimulusPermissionUpdate", () => {
  it("still accepts the three keys an older app sends", () => {
    const body = StimulusPermissionUpdate.parse(grant);
    expect(body).toEqual(grant);
    expect("automationAllowed" in body).toBe(false);
  });

  it("accepts an explicit answer, and null for 'back to the default'", () => {
    expect(StimulusPermissionUpdate.parse({ ...grant, automationAllowed: false }).automationAllowed)
      .toBe(false);
    expect(StimulusPermissionUpdate.parse({ ...grant, automationAllowed: null }).automationAllowed)
      .toBeNull();
    expect(StimulusPermissionUpdate.safeParse({ ...grant, automationAllowed: "no" }).success).toBe(
      false,
    );
  });

  it("drops the read-only effective value a newer app might echo back", () => {
    const body = StimulusPermissionUpdate.parse({ ...grant, automationAllowedEffective: true });
    expect(body).not.toHaveProperty("automationAllowedEffective");
  });
});

describe("permissionWrite", () => {
  /**
   * The compatibility rule: an app that predates the key sends a full
   * overwrite of the other three. Treating the missing key as null would
   * wipe an answer the user gave on the web — so it is not written at all.
   */
  it("leaves the stored answer alone when the key is absent", () => {
    expect(permissionWrite(grant)).toEqual(grant);
    expect(permissionWrite(grant)).not.toHaveProperty("automationAllowed");
  });

  it("writes an explicit answer, and writes null to reset it", () => {
    expect(permissionWrite({ ...grant, automationAllowed: true }).automationAllowed).toBe(true);
    expect(permissionWrite({ ...grant, automationAllowed: false }).automationAllowed).toBe(false);
    expect(permissionWrite({ ...grant, automationAllowed: null })).toHaveProperty(
      "automationAllowed",
      null,
    );
  });
});

describe("presentPermission", () => {
  it("reports the explicit answer and what applies under each policy", () => {
    const unanswered = { ...grant, automationAllowed: null };
    expect(presentPermission(unanswered, false)).toEqual({
      ...grant,
      automationAllowed: null,
      automationAllowedEffective: true,
    });
    expect(presentPermission(unanswered, true).automationAllowedEffective).toBe(false);

    // An explicit answer wins, and the policy never rewrites it.
    expect(presentPermission({ ...grant, automationAllowed: false }, false)).toMatchObject({
      automationAllowed: false,
      automationAllowedEffective: false,
    });
    expect(presentPermission({ ...grant, automationAllowed: true }, true)).toMatchObject({
      automationAllowed: true,
      automationAllowedEffective: true,
    });
  });

  it("matches the response schema, the three original keys untouched", () => {
    const value = presentPermission({ ...grant, automationAllowed: null }, true);
    expect(StimulusPermission.parse(value)).toEqual(value);
  });
});

describe("emptyPermissionSet", () => {
  it("starts every kind disabled and unanswered", () => {
    const set = emptyPermissionSet(false);
    for (const kind of ["zap", "vibe", "beep"] as const) {
      expect(set[kind]).toEqual({
        isAllowed: false,
        maxIntensity: 0,
        cooldownSeconds: 0,
        automationAllowed: null,
        automationAllowedEffective: true,
      });
    }
  });
});
