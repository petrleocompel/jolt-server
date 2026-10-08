import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useHydrated } from "#/lib/use-hydrated";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { createMyApiToken, fetchMyApiTokens, revokeMyApiToken } from "#/server/api-tokens";
import { fetchFriends } from "#/server/friends";
import type { ApiToken, ApiTokenCreated, ApiTokenScope, Friend } from "#/api/schemas";

export const Route = createFileRoute("/dashboard/tokens")({
  loader: async () => {
    const [tokens, friends] = await Promise.all([fetchMyApiTokens(), fetchFriends()]);
    return { tokens, friends };
  },
  component: Tokens,
});

/** Every scope, in the order the form lists them, with what it unlocks. */
const SCOPES: Array<{ scope: ApiTokenScope; label: string; detail: string }> = [
  { scope: "stimulus:self", label: "Jolt me", detail: "POST /me/stimulus — fire at your own devices" },
  { scope: "pokes:send", label: "Poke friends", detail: "POST /pokes — within what each friend allows you" },
  { scope: "friends:read", label: "See friends", detail: "GET /friends — ids, names and permissions" },
  { scope: "pokes:read", label: "Read activity", detail: "GET /pokes — pokes with the friends it reaches" },
  { scope: "*", label: "Everything", detail: "every scope, including ones added later" },
];

const PRESETS: Array<{ label: string; scopes: Array<ApiTokenScope> }> = [
  { label: "Self", scopes: ["stimulus:self"] },
  { label: "Friends", scopes: ["pokes:send", "friends:read"] },
  { label: "Self + friends", scopes: ["stimulus:self", "pokes:send", "friends:read"] },
  { label: "All", scopes: ["*"] },
];

/** Scopes that involve other people, and so make the friend picker matter. */
const FRIEND_SCOPES: Array<ApiTokenScope> = ["*", "pokes:send", "friends:read", "pokes:read"];

function sameScopes(a: Array<ApiTokenScope>, b: Array<ApiTokenScope>): boolean {
  return a.length === b.length && a.every((scope) => b.includes(scope));
}

/** Null is "until I revoke it" — the honest default for a home automation. */
const LIFETIMES: Array<{ label: string; days?: number }> = [
  { label: "Until revoked" },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];

function Tokens() {
  const { tokens, friends } = Route.useLoaderData();
  const router = useRouter();

  const [name, setName] = useState("");
  const [days, setDays] = useState<number | undefined>(undefined);
  const [scopes, setScopes] = useState<Array<ApiTokenScope>>(["stimulus:self"]);
  const [friendMode, setFriendMode] = useState<"all" | "selected">("all");
  const [friendIds, setFriendIds] = useState<Array<string>>([]);
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);

  const reachesFriends = scopes.some((scope) => FRIEND_SCOPES.includes(scope));
  // A `selected` token with nobody ticked is valid, but never what someone
  // filling in this form meant — the API allows it, the button does not.
  const friendsMissing = reachesFriends && friendMode === "selected" && friendIds.length === 0;

  function toggleScope(scope: ApiTokenScope, on: boolean) {
    setScopes((current) =>
      on ? [...current.filter((s) => s !== scope), scope] : current.filter((s) => s !== scope),
    );
  }

  function toggleFriend(friendId: string, on: boolean) {
    setFriendIds((current) =>
      on ? [...current.filter((id) => id !== friendId), friendId] : current.filter((id) => id !== friendId),
    );
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    try {
      // Held in component state, not refetched: this is the only moment the
      // secret exists anywhere outside the integration it is going into.
      setCreated(
        await createMyApiToken({
          data: {
            name,
            expiresInDays: days,
            scopes,
            // Sent only when it narrows something: a self-only token has no
            // friends to restrict, and `all` is the absence of a list.
            ...(reachesFriends && friendMode === "selected" ? { friendIds } : {}),
          },
        }),
      );
      setName("");
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the token.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(tokenId: string) {
    setBusy(tokenId);
    setError(null);
    try {
      await revokeMyApiToken({ data: { tokenId } });
      if (created?.id === tokenId) setCreated(null);
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke the token.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        An access token lets your own code act for you — jolt you when a build fails or a timer
        runs out, or poke a friend from a home automation. You choose what each token may do and
        which friends it may reach. A poke sent with one is marked as automated, and it never goes
        beyond what that friend allows you; a token can never manage tokens, devices, friend
        requests or permissions, and it cannot reach this page.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>New token</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" method="post" onSubmit={(event) => void create(event)}>
            <div className="grid gap-1.5">
              <Label htmlFor="token-name">What is it for?</Label>
              <Input
                id="token-name"
                value={name}
                maxLength={60}
                required
                placeholder="home assistant"
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <fieldset className="grid gap-2">
              <legend className="text-muted-foreground mb-1.5 text-xs font-medium">
                What may it do?
              </legend>
              <div className="flex flex-wrap gap-1">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    size="sm"
                    variant={sameScopes(scopes, preset.scopes) ? "default" : "outline"}
                    onClick={() => setScopes(preset.scopes)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <div className="grid gap-1.5">
                {SCOPES.map(({ scope, label, detail }) => {
                  const implied = scope !== "*" && scopes.includes("*");
                  return (
                    <label key={scope} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-primary mt-0.5 size-4"
                        checked={implied || scopes.includes(scope)}
                        disabled={implied}
                        onChange={(event) => toggleScope(scope, event.target.checked)}
                      />
                      <span>
                        {label} <code className="text-muted-foreground text-xs">{scope}</code>
                        <span className="text-muted-foreground block text-xs">{detail}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {reachesFriends && (
              <fieldset className="grid gap-2">
                <legend className="text-muted-foreground mb-1.5 text-xs font-medium">
                  Which friends may it reach?
                </legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="friend-scope"
                    className="accent-primary size-4"
                    checked={friendMode === "all"}
                    onChange={() => setFriendMode("all")}
                  />
                  All friends, including ones you add later
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="friend-scope"
                    className="accent-primary size-4"
                    checked={friendMode === "selected"}
                    onChange={() => setFriendMode("selected")}
                  />
                  Only the friends I pick
                </label>
                {friendMode === "selected" && (
                  <div className="ml-6 grid gap-1.5">
                    {friends.length === 0 ? (
                      <p className="text-muted-foreground text-xs">You have no friends to pick yet.</p>
                    ) : (
                      friends.map((friend) => (
                        <label key={friend.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="accent-primary size-4"
                            checked={friendIds.includes(friend.id)}
                            onChange={(event) => toggleFriend(friend.id, event.target.checked)}
                          />
                          {friend.displayName}
                          <span className="text-muted-foreground">@{friend.handle}</span>
                        </label>
                      ))
                    )}
                    <p className="text-muted-foreground text-xs">
                      Unfriending someone takes them off this list for good — re-adding them
                      later does not put them back.
                    </p>
                  </div>
                )}
              </fieldset>
            )}

            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs">Expires</Label>
              <div className="flex flex-wrap gap-1">
                {LIFETIMES.map((lifetime) => (
                  <Button
                    key={lifetime.label}
                    type="button"
                    size="sm"
                    variant={days === lifetime.days ? "default" : "outline"}
                    onClick={() => setDays(lifetime.days)}
                  >
                    {lifetime.label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Button
                type="submit"
                disabled={
                  busy !== null ||
                  name.trim().length === 0 ||
                  scopes.length === 0 ||
                  friendsMissing ||
                  !hydrated
                }
              >
                {busy === "create" ? "Creating…" : "Create token"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {created && <NewToken token={created} friends={friends} />}

      {tokens.length === 0 ? (
        <p className="text-muted-foreground text-sm">No tokens yet.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Your tokens</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>May</TableHead>
                  <TableHead>Friends</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => {
                  const expired =
                    token.expiresAt !== null && new Date(token.expiresAt) <= new Date();
                  return (
                    <TableRow key={token.id}>
                      <TableCell>{token.name}</TableCell>
                      <TableCell className="font-mono text-xs">jolt_pat_{token.prefix}…</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {token.scopes.map((scope) => (
                            <Badge key={scope} variant="outline" className="font-mono">
                              {scope}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        <FriendReach token={token} friends={friends} />
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {new Date(token.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : "never"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {token.expiresAt === null ? (
                          <Badge variant="outline">until revoked</Badge>
                        ) : expired ? (
                          <Badge variant="outline">expired</Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            {new Date(token.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void revoke(token.id)}
                        >
                          {busy === token.id ? "Revoking…" : "Revoke"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** "all friends", "nobody", or the names on a `selected` token's list. */
function FriendReach({ token, friends }: { token: ApiToken; friends: Array<Friend> }) {
  if (!token.scopes.some((scope) => FRIEND_SCOPES.includes(scope))) return <>—</>;
  if (token.friendScope === "all") return <>all friends</>;
  if (token.friendIds.length === 0) return <>nobody</>;
  const names = token.friendIds.map(
    (id) => friends.find((friend) => friend.id === id)?.displayName ?? "former friend",
  );
  return <>{names.join(", ")}</>;
}

/**
 * The secret, the once. Only its hash is stored, so there is no screen that
 * can show it again — hence the copy button and the warning rather than a
 * quiet line of monospace.
 */
function NewToken({ token, friends }: { token: ApiTokenCreated; friends: Array<Friend> }) {
  const [copied, setCopied] = useState(false);
  // Server-rendered first, so the origin is only known once mounted.
  const origin = typeof window === "undefined" ? "https://jolt.example" : window.location.origin;
  const can = (scope: ApiTokenScope) => token.scopes.includes("*") || token.scopes.includes(scope);
  // A real friend id in the example beats a placeholder nobody can paste.
  const friend =
    token.friendScope === "selected"
      ? friends.find((f) => token.friendIds.includes(f.id))
      : friends[0];

  async function copy() {
    try {
      await navigator.clipboard.writeText(token.token);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the token is on screen to select.
      setCopied(false);
    }
  }

  return (
    <Card className="border-jolt-400/40">
      <CardHeader>
        <CardTitle>Copy {token.name} now</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          This is the only time it is shown. Only its hash is stored, so if you lose it you mint a
          new one — there is nothing to look up.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-muted flex-1 rounded-md px-3 py-2 font-mono text-xs break-all">
            {token.token}
          </code>
          <Button type="button" size="sm" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {can("stimulus:self") && (
          <div>
            <p className="text-muted-foreground mb-1 text-xs">Fire a vibe at your own devices:</p>
            <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
              {`curl -X POST ${origin}/api/v1/me/stimulus \\
  -H "Authorization: Bearer ${token.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"stimulus":{"kind":"vibe","intensity":20,"repetitions":1}}'`}
            </pre>
          </div>
        )}
        {can("pokes:send") && (
          <div>
            <p className="text-muted-foreground mb-1 text-xs">
              Buzz {friend ? friend.displayName : "a friend"} — within what they allow you:
            </p>
            <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
              {`curl -X POST ${origin}/api/v1/pokes \\
  -H "Authorization: Bearer ${token.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"friendId":"${friend?.id ?? "FRIEND_ID"}","stimulus":{"kind":"vibe","intensity":20,"repetitions":1}}'`}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
