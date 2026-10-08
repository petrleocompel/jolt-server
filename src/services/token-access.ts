import { ApiTokenScope } from "#/api/schemas";
import type { ApiTokenFriendScope, StimulusConfig, StimulusKind } from "#/api/schemas";

/**
 * What a personal access token may do, as pure functions of the token. No
 * database here on purpose: these are the rules every token-accepting
 * endpoint applies, and they are worth being able to read — and test — on
 * their own. The rows they read are loaded by src/services/api-tokens.ts.
 */

/** A scope an endpoint can ask for. `*` is something a token has, not a need. */
export type RequiredScope = Exclude<ApiTokenScope, "*">;

/**
 * The token behind a request, as the handlers need it: what it may do and
 * whom it may reach. Services take `ApiTokenContext | null`, and null always
 * means a session — the account holder, in person.
 */
export interface ApiTokenContext {
  id: string;
  name: string;
  prefix: string;
  scopes: ReadonlyArray<ApiTokenScope>;
  friendScope: ApiTokenFriendScope;
  /** Only consulted when `friendScope` is `selected`. */
  friendIds: ReadonlySet<string>;
  /** Null is every kind. */
  allowedKinds: ReadonlyArray<StimulusKind> | null;
  /** Null leaves only the recipient's cap. */
  maxIntensity: number | null;
  minIntervalSeconds: number;
}

/**
 * The stored scopes, minus any this build does not know. A scope retired in
 * a later release must not keep granting whatever it used to — and must not
 * crash the token list either.
 */
export function readScopes(stored: ReadonlyArray<string>): Array<ApiTokenScope> {
  return stored.filter((scope): scope is ApiTokenScope => ApiTokenScope.safeParse(scope).success);
}

/** `*` grants every scope, including ones added after the token was minted. */
export function tokenHasScope(
  scopes: ReadonlyArray<ApiTokenScope>,
  needed: RequiredScope,
): boolean {
  return scopes.includes("*") || scopes.includes(needed);
}

/** Whether a token may act on, or see, this friend. */
export function tokenReachesFriend(
  token: Pick<ApiTokenContext, "friendScope" | "friendIds">,
  friendId: string,
): boolean {
  return token.friendScope === "all" || token.friendIds.has(friendId);
}

/**
 * Which events `GET /pokes` shows a token: the ones with friends it reaches
 * and — only if it may fire them — the caller's own self-stimuli. A token
 * minted to poke one friend has no business reading when its owner jolts
 * themselves, and vice versa.
 *
 * `friends: "all"` still means "everyone the account has poked", ex-friends
 * included, exactly as a session sees it.
 */
export function pokeVisibility(
  token: Pick<ApiTokenContext, "scopes" | "friendScope" | "friendIds">,
): { friends: "all" | Array<string>; includeSelf: boolean } {
  return {
    friends: token.friendScope === "all" ? "all" : [...token.friendIds],
    includeSelf: tokenHasScope(token.scopes, "stimulus:self"),
  };
}

/** How a token names itself in a log line: never the secret, never enough to forge it. */
export function describeToken(token: Pick<ApiTokenContext, "id" | "name">): string {
  return `API token ${token.id.slice(0, 8)} "${token.name}"`;
}

/**
 * Why this token may not fire this stimulus, or null if it may. The token's
 * own limits only — the recipient's grant is checked separately, and both
 * have to pass, so a token can narrow what a friend allows but never widen
 * it.
 */
export function tokenStimulusViolation(
  token: Pick<ApiTokenContext, "allowedKinds" | "maxIntensity">,
  stimulus: StimulusConfig,
): string | null {
  if (token.allowedKinds && !token.allowedKinds.includes(stimulus.kind)) {
    return `This token can't send ${stimulus.kind}.`;
  }
  if (token.maxIntensity !== null && stimulus.intensity > token.maxIntensity) {
    return `Intensity exceeds this token's cap of ${token.maxIntensity}.`;
  }
  return null;
}
