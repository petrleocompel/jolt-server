import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  acceptFriendRequest,
  fetchRequests,
  rejectFriendRequest,
  submitFriendRequest,
} from "#/server/friends";

export const Route = createFileRoute("/dashboard/requests")({
  loader: () => fetchRequests(),
  component: Requests,
});

function Requests() {
  const { incoming, outgoing } = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const handle = String(form.get("handle") ?? "").trim();
    const inviteCode = String(form.get("inviteCode") ?? "").trim();

    // The contract takes exactly one — there is no discovery endpoint.
    if (Boolean(handle) === Boolean(inviteCode)) {
      setBusy(false);
      setError("Fill in exactly one of handle or invite code.");
      return;
    }

    try {
      await submitFriendRequest({
        data: handle ? { handle } : { inviteCode },
      });
      event.currentTarget.reset();
      await router.invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a friend</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={send} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="handle">Handle</Label>
              <Input id="handle" name="handle" placeholder="alice" />
            </div>
            <span className="text-muted-foreground pb-2 text-sm">or</span>
            <div className="grid flex-1 gap-2">
              <Label htmlFor="inviteCode">Invite code</Label>
              <Input id="inviteCode" name="inviteCode" placeholder="JOLT-K7QM-4821" />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send request"}
            </Button>
          </form>
          {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Incoming</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {incoming.length === 0 && (
              <p className="text-muted-foreground text-sm">Nothing pending.</p>
            )}
            {incoming.map((request) => (
              <div key={request.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  {request.displayName}{" "}
                  <span className="text-muted-foreground">@{request.handle}</span>
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      await acceptFriendRequest({ data: { requestId: request.id } });
                      await router.invalidate();
                    }}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await rejectFriendRequest({ data: { requestId: request.id } });
                      await router.invalidate();
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Outgoing</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {outgoing.length === 0 && (
              <p className="text-muted-foreground text-sm">Nothing pending.</p>
            )}
            {outgoing.map((request) => (
              <div key={request.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  {request.displayName}{" "}
                  <span className="text-muted-foreground">@{request.handle}</span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await rejectFriendRequest({ data: { requestId: request.id } });
                    await router.invalidate();
                  }}
                >
                  Cancel
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
