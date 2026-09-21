/**
 * Better Auth trusts exactly one origin by default: whatever `baseURL` says.
 * Every other name the same server answers to — `localhost` when
 * BETTER_AUTH_URL names `127.0.0.1`, a LAN IP, a second domain in front of
 * the proxy — gets `403 INVALID_ORIGIN` on sign-in, which the login form can
 * only report as a failed login. That is the whole bug: correct password,
 * permanent bounce back to /login.
 */

/** Hosts that are the same machine as the caller, so same-port aliases of each other. */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** `new URL().origin`, or the trimmed input when it is a pattern like `https://*.example.com`. */
function normalize(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    // Better Auth also accepts wildcard patterns, which are not valid URLs.
    return trimmed;
  }
}

/** Same-port loopback aliases of `origin`, or none if it is not a loopback origin. */
function loopbackAliases(origin: string): Array<string> {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return [];
  }
  if (!LOOPBACK_HOSTS.includes(url.host.replace(/:\d+$/, ""))) return [];
  const port = url.port ? `:${url.port}` : "";
  return LOOPBACK_HOSTS.map((host) => `${url.protocol}//${host}${port}`);
}

/**
 * The origins Better Auth accepts a cookie-bearing request from.
 *
 * `baseURL` always counts. `extra` is the operator's comma-separated
 * TRUSTED_ORIGINS, for a deployment reachable under more than one name.
 * In development the loopback aliases are added too: `pnpm dev` prints a
 * `localhost` URL while the default baseURL says `127.0.0.1`, and a browser
 * that follows the printed link must still be able to log in.
 */
export function buildTrustedOrigins({
  baseURL,
  extra,
  isDevelopment,
}: {
  baseURL: string;
  extra?: string;
  isDevelopment: boolean;
}): Array<string> {
  const base = normalize(baseURL);
  const origins = [
    ...(base ? [base] : []),
    ...(extra?.split(",") ?? []).flatMap((entry) => normalize(entry) ?? []),
    ...(isDevelopment && base ? loopbackAliases(base) : []),
  ];
  return [...new Set(origins)];
}
