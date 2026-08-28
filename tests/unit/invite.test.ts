import { describe, expect, it } from "vitest";
import { generateInviteCode, isValidHandle, normalizeHandle } from "#/lib/invite";

describe("normalizeHandle", () => {
  it("lowercases, trims, and drops a leading @", () => {
    expect(normalizeHandle("  @Alice  ")).toBe("alice");
  });
});

describe("isValidHandle", () => {
  it.each(["abc", "a_b_c", "user123", "a".repeat(20)])("accepts %s", (handle) => {
    expect(isValidHandle(handle)).toBe(true);
  });

  it.each(["ab", "a".repeat(21), "Alice", "has space", "dash-no", "@alice", ""])(
    "rejects %s",
    (handle) => {
      expect(isValidHandle(handle)).toBe(false);
    },
  );
});

describe("generateInviteCode", () => {
  it("matches the JOLT-XXXX-NNNN shape", () => {
    expect(generateInviteCode()).toMatch(/^JOLT-[A-Z]{4}-\d{4}$/);
  });

  it("omits ambiguous letters so codes survive being read aloud", () => {
    // Only the random block — the literal "JOLT-" prefix contains O and L.
    const letters = Array.from({ length: 200 }, generateInviteCode)
      .map((code) => code.split("-")[1])
      .join("");
    expect(letters).not.toMatch(/[ILOU]/);
  });

  it("does not collide across a reasonable sample", () => {
    const codes = new Set(Array.from({ length: 500 }, generateInviteCode));
    expect(codes.size).toBeGreaterThan(490);
  });
});
