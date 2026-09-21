import { describe, expect, it } from "vitest";
import { buildTrustedOrigins } from "#/auth/origins";

describe("buildTrustedOrigins", () => {
  it("always trusts the base URL, normalised to an origin", () => {
    expect(
      buildTrustedOrigins({ baseURL: "https://Jolt.Example.com/", isDevelopment: false }),
    ).toEqual(["https://jolt.example.com"]);
  });

  it("trusts the loopback aliases of a dev server, whichever name the browser used", () => {
    // `pnpm dev` prints http://localhost:3000 while the default baseURL says
    // 127.0.0.1 — signing in from the printed link used to 403.
    const origins = buildTrustedOrigins({
      baseURL: "http://127.0.0.1:3000",
      isDevelopment: true,
    });
    expect(origins).toContain("http://127.0.0.1:3000");
    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("http://[::1]:3000");
  });

  it("keeps loopback aliases on the port the server actually runs on", () => {
    expect(buildTrustedOrigins({ baseURL: "http://localhost:3001", isDevelopment: true })).toContain(
      "http://127.0.0.1:3001",
    );
  });

  it("does not widen a production deployment to loopback", () => {
    expect(
      buildTrustedOrigins({ baseURL: "https://jolt.example.com", isDevelopment: false }),
    ).toEqual(["https://jolt.example.com"]);
  });

  it("never invents loopback aliases for a public host", () => {
    expect(buildTrustedOrigins({ baseURL: "https://jolt.example.com", isDevelopment: true })).toEqual(
      ["https://jolt.example.com"],
    );
  });

  it("adds the operator's extra origins", () => {
    expect(
      buildTrustedOrigins({
        baseURL: "https://jolt.example.com",
        extra: "http://192.168.1.10:7385, https://www.jolt.example.com",
        isDevelopment: false,
      }),
    ).toEqual([
      "https://jolt.example.com",
      "http://192.168.1.10:7385",
      "https://www.jolt.example.com",
    ]);
  });

  it("ignores blank entries from a trailing comma", () => {
    expect(
      buildTrustedOrigins({
        baseURL: "https://jolt.example.com",
        extra: "https://a.example.com,, ",
        isDevelopment: false,
      }),
    ).toEqual(["https://jolt.example.com", "https://a.example.com"]);
  });

  it("passes wildcard patterns through untouched", () => {
    expect(
      buildTrustedOrigins({
        baseURL: "https://jolt.example.com",
        extra: "*.jolt.example.com",
        isDevelopment: false,
      }),
    ).toContain("*.jolt.example.com");
  });

  it("lists every origin once", () => {
    const origins = buildTrustedOrigins({
      baseURL: "http://localhost:3000",
      extra: "http://localhost:3000/,http://127.0.0.1:3000",
      isDevelopment: true,
    });
    expect(new Set(origins).size).toBe(origins.length);
  });
});
