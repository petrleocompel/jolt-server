import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { isClientAbort } from "#/api/client-abort";

/**
 * The default TanStack Start server entry, plus the one thing its logs leave
 * out when a client hangs up mid-request: which request it was.
 *
 * When a phone disconnects while still sending a body (the app suspended by a
 * locked screen, a background wake that ran out of time), Node aborts the
 * request and TanStack Start's `request.signal.throwIfAborted()` rethrows that
 * *after* our route has already answered. Its bundled h3 then prints it as an
 * unhandled 500 — `Error: aborted`, `ECONNRESET`, a stack trace, and no
 * method or path. That print is not configurable, and avoiding it would mean
 * rebuilding the request with a signal of our own, which is exactly what
 * TanStack uses to stop rendering for a client that is gone. So it stays, and
 * this names it on the next line.
 */
export default createServerEntry({
  async fetch(request, ...rest) {
    const label = () => `${request.method} ${new URL(request.url).pathname}`;
    try {
      const response = await handler.fetch(request, ...rest);
      if (request.signal.aborted && isClientAbort(request.signal.reason)) {
        console.warn(
          `[http] client hung up mid-request: ${label()} — the "Error: aborted" ` +
            `above is this request, not a server fault`,
        );
      }
      return response;
    } catch (error) {
      if (!isClientAbort(error)) throw error;
      // Not how TanStack surfaces it today, but a later version may simply
      // let it propagate — in which case there is no dump to point at.
      console.warn(`[http] client hung up mid-request: ${label()}`);
      // nginx's "client closed request". Nobody will read it — the socket is
      // gone — but it keeps the request out of the 5xx that mean "our bug".
      return new Response(null, { status: 499 });
    }
  },
});
