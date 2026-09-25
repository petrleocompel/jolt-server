import { describe, expect, it } from "vitest";
import { isClientAbort } from "#/api/client-abort";

/** What `abortIncoming` in node:_http_server throws. */
function nodeAbort(): Error {
  return Object.assign(new Error("aborted"), { code: "ECONNRESET" });
}

describe("isClientAbort", () => {
  it("recognises the error Node raises for a client that hung up mid-body", () => {
    expect(isClientAbort(nodeAbort())).toBe(true);
  });

  it("sees through a layer that wrapped it", () => {
    // The shape from the production log: h3's error around Node's.
    expect(isClientAbort(new Error("aborted", { cause: nodeAbort() }))).toBe(true);
  });

  it("leaves real failures alone", () => {
    // A reset on an *outgoing* connection (Postgres, APNs) is our problem, not
    // a client leaving — same code, different message.
    expect(isClientAbort(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(false);
    expect(isClientAbort(new Error("aborted"))).toBe(false);
    expect(isClientAbort("aborted")).toBe(false);
    expect(isClientAbort(undefined)).toBe(false);
  });
});
