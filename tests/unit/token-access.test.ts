import { describe, expect, it } from "vitest";
import {
  describeToken,
  pokeVisibility,
  readScopes,
  tokenHasScope,
  tokenReachesFriend,
  tokenStimulusViolation,
} from "#/services/token-access";
import type { ApiTokenContext } from "#/services/token-access";

/**
 * The rules every token-accepting endpoint applies, without a database: what
 * a scope grants, whom a token reaches, what its activity feed shows.
 */

const ALICE = "6f1c1a52-6f0e-4c39-9d6c-6a0e8c1f0a01";
const BOB = "6f1c1a52-6f0e-4c39-9d6c-6a0e8c1f0a02";

function token(overrides: Partial<ApiTokenContext> = {}): ApiTokenContext {
  return {
    id: "0b6c7c55-5d2b-4d3e-9a51-0e7c3c3f7e10",
    name: "home assistant",
    prefix: "abcdef",
    scopes: ["stimulus:self"],
    friendScope: "all",
    friendIds: new Set(),
    allowedKinds: null,
    maxIntensity: null,
    minIntervalSeconds: 1,
    ...overrides,
  };
}

describe("tokenHasScope", () => {
  it("grants exactly the scopes it lists", () => {
    expect(tokenHasScope(["stimulus:self"], "stimulus:self")).toBe(true);
    expect(tokenHasScope(["stimulus:self"], "pokes:send")).toBe(false);
    expect(tokenHasScope(["pokes:send", "friends:read"], "friends:read")).toBe(true);
    expect(tokenHasScope(["pokes:send", "friends:read"], "pokes:read")).toBe(false);
  });

  it("treats * as every scope, including ones this build has never heard of", () => {
    for (const scope of ["stimulus:self", "pokes:send", "friends:read", "pokes:read"] as const) {
      expect(tokenHasScope(["*"], scope)).toBe(true);
    }
    // A scope added in a later release is still covered by a wildcard token
    // minted today — that is the promise `*` makes.
    expect(tokenHasScope(["*"], "devices:read" as never)).toBe(true);
  });

  it("grants nothing to an empty list", () => {
    expect(tokenHasScope([], "stimulus:self")).toBe(false);
  });
});

describe("readScopes", () => {
  it("drops values this build does not know instead of honouring them", () => {
    expect(readScopes(["stimulus:self", "admin:everything", "*"])).toEqual(["stimulus:self", "*"]);
  });
});

describe("tokenReachesFriend", () => {
  it("reaches every friend with friendScope all", () => {
    expect(tokenReachesFriend(token(), ALICE)).toBe(true);
  });

  it("reaches only listed friends with friendScope selected", () => {
    const t = token({ friendScope: "selected", friendIds: new Set([ALICE]) });
    expect(tokenReachesFriend(t, ALICE)).toBe(true);
    expect(tokenReachesFriend(t, BOB)).toBe(false);
  });

  it("reaches nobody once its list is emptied — never everybody", () => {
    // What unfriending the last listed friend leaves behind.
    const t = token({ friendScope: "selected", friendIds: new Set() });
    expect(tokenReachesFriend(t, ALICE)).toBe(false);
    expect(tokenReachesFriend(t, BOB)).toBe(false);
  });
});

describe("pokeVisibility", () => {
  it("shows self-stimuli only to a token that may fire them", () => {
    expect(pokeVisibility(token({ scopes: ["pokes:read"] })).includeSelf).toBe(false);
    expect(pokeVisibility(token({ scopes: ["pokes:read", "stimulus:self"] })).includeSelf).toBe(
      true,
    );
    expect(pokeVisibility(token({ scopes: ["*"] })).includeSelf).toBe(true);
  });

  it("limits a selected token to its listed friends, and an empty list to none", () => {
    expect(pokeVisibility(token({ scopes: ["pokes:read"] })).friends).toBe("all");
    expect(
      pokeVisibility(
        token({ scopes: ["pokes:read"], friendScope: "selected", friendIds: new Set([BOB]) }),
      ).friends,
    ).toEqual([BOB]);
    expect(
      pokeVisibility(token({ scopes: ["pokes:read"], friendScope: "selected" })).friends,
    ).toEqual([]);
  });
});

describe("describeToken", () => {
  it("names the token by id prefix and name, never by secret", () => {
    expect(describeToken(token())).toBe('API token 0b6c7c55 "home assistant"');
  });
});

describe("tokenStimulusViolation", () => {
  const zap = { kind: "zap", intensity: 40, repetitions: 1 } as const;

  it("lets anything through a token with no limits of its own", () => {
    // The recipient's grant still applies — this is only the token's half.
    expect(tokenStimulusViolation(token(), { ...zap, intensity: 100 })).toBeNull();
  });

  it("refuses a kind the token was not minted for", () => {
    const t = token({ allowedKinds: ["vibe", "beep"] });
    expect(tokenStimulusViolation(t, zap)).toBe("This token can't send zap.");
    expect(tokenStimulusViolation(t, { ...zap, kind: "vibe" })).toBeNull();
  });

  it("refuses an intensity above the token's own cap, and allows one at it", () => {
    const t = token({ maxIntensity: 30 });
    expect(tokenStimulusViolation(t, zap)).toBe("Intensity exceeds this token's cap of 30.");
    expect(tokenStimulusViolation(t, { ...zap, intensity: 30 })).toBeNull();
  });

  it("treats a cap of 0 as a cap, not as no cap", () => {
    expect(tokenStimulusViolation(token({ maxIntensity: 0 }), { ...zap, intensity: 1 })).not.toBe(
      null,
    );
  });
});
