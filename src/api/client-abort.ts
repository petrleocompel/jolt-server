/**
 * The error Node raises when a client closes its connection while the server
 * is still receiving the request body: `abortIncoming` destroys the request
 * with an `ECONNRESET` whose message is `"aborted"`.
 *
 * For this app that is almost always a phone: the user taps "poke", locks the
 * screen, and iOS suspends the app mid-upload — or a background wake runs out
 * of time halfway through an ack. It is not a server fault, and there is
 * nobody left to answer, so it deserves one line in the log rather than the
 * 500-with-a-stack-trace the framework would otherwise print.
 *
 * Checked on the error and its `cause`, since a layer in between may have
 * wrapped it by the time it arrives.
 */
export function isClientAbort(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth++) {
    const code = (current as NodeJS.ErrnoException).code;
    if (code === "ECONNRESET" && current.message === "aborted") return true;
    current = current.cause;
  }
  return false;
}
