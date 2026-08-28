import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { fetchSession } from "#/server/session";

export const Route = createFileRoute("/invite/$code")({
  loader: () => fetchSession(),
  component: AcceptInvite,
});

/**
 * Public landing for a scanned QR. Deliberately does not confirm whether the
 * code is real before sign-in — that would turn this into the discovery
 * endpoint the product decision rules out.
 */
function AcceptInvite() {
  const session = Route.useLoaderData();
  const { code } = Route.useParams();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <Card>
        <CardHeader>
          <CardTitle>You&apos;ve been invited to Jolt</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Invite code: <span className="text-foreground font-mono">{code}</span>
          </p>
          {session ? (
            <>
              <p className="text-sm">
                Paste this code on the Requests tab to send a friend request.
              </p>
              <Button asChild>
                <Link to="/dashboard/requests">Go to requests</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm">Create an account or log in, then use the code to connect.</p>
              <div className="flex gap-2">
                <Button asChild>
                  <Link to="/signup">Sign up</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/login">Log in</Link>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
