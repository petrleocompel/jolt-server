import { useEffect, useState } from "react";

/**
 * False until React has hydrated this page in the browser, true afterwards.
 *
 * Between the server's HTML arriving and hydration finishing, a `<form>` is
 * still a plain HTML form: `onSubmit` is not attached yet, so pressing Enter
 * or clicking submit runs the browser's *native* submission instead. With no
 * `action`, that is a GET to the current URL — the page reloads, the handler
 * never runs, and every field lands in the query string. On /login that means
 * a password in the address bar, in history and in the server's access log,
 * and a user who sees nothing happen but a bounce back to the login page.
 *
 * Gating the submit button on this closes the window: the HTML spec requires
 * that a form whose default button is disabled is not submitted, which stops
 * the Enter key as well as the click.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
