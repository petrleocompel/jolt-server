import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { createMyApiToken, fetchMyApiTokens, revokeMyApiToken } from "#/server/api-tokens";
import type { ApiTokenCreated } from "#/api/schemas";

export const Route = createFileRoute("/dashboard/tokens")({
  loader: () => fetchMyApiTokens(),
  component: Tokens,
});

/** Null is "until I revoke it" — the honest default for a home automation. */
const LIFETIMES: Array<{ label: string; days?: number }> = [
  { label: "Until revoked" },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];

function Tokens() {
  const tokens = Route.useLoaderData();
  const router = useRouter();

  const [name, setName] = useState("");
  const [days, setDays] = useState<number | undefined>(undefined);
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    try {
      // Held in component state, not refetched: this is the only moment the
      // secret exists anywhere outside the integration it is going into.
      setCreated(await createMyApiToken({ data: { name, expiresInDays: days } }));
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
        An access token lets your own code jolt you — a build that failed, a timer that ran out,
        anything that can make an HTTP request. It can read your account and fire a stimulus at
        your own devices, and nothing else: not your friends, not other people&apos;s devices, and
        not this page.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>New token</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={(event) => void create(event)}>
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
              <Button type="submit" disabled={busy !== null || name.trim().length === 0}>
                {busy === "create" ? "Creating…" : "Create token"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {created && <NewToken token={created} />}

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

/**
 * The secret, the once. Only its hash is stored, so there is no screen that
 * can show it again — hence the copy button and the warning rather than a
 * quiet line of monospace.
 */
function NewToken({ token }: { token: ApiTokenCreated }) {
  const [copied, setCopied] = useState(false);
  // Server-rendered first, so the origin is only known once mounted.
  const origin = typeof window === "undefined" ? "https://jolt.example" : window.location.origin;

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
        <div>
          <p className="text-muted-foreground mb-1 text-xs">Fire a vibe at your own devices:</p>
          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
            {`curl -X POST ${origin}/api/v1/me/stimulus \\
  -H "Authorization: Bearer ${token.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"stimulus":{"kind":"vibe","intensity":20,"repetitions":1}}'`}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
