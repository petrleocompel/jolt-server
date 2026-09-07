import { createFileRoute, Link } from "@tanstack/react-router";
import { JoltMark } from "#/components/jolt-mark";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader } from "#/components/ui/card";
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
    <main className="brand-glow flex min-h-screen flex-col items-center justify-center p-8">
      <Card className="w-full max-w-sm border-white/5">
        <CardHeader className="flex flex-col items-center gap-3 text-center">
          <JoltMark className="size-8" />
          <h1 className="text-xl font-semibold tracking-tight">You&apos;ve been invited to Jolt</h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-center text-sm">
            Invite code: <span className="font-mono text-foreground">{code}</span>
          </p>
          {session ? (
            <>
              <p className="text-center text-sm">
                Paste this code on the Requests tab to send a friend request.
              </p>
              <Button asChild>
                <Link to="/dashboard/requests">Go to requests</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-center text-sm">
                Create an account or log in, then use the code to connect.
              </p>
              <div className="flex gap-2">
                <Button asChild className="flex-1">
                  <Link to="/signup">Sign up</Link>
                </Button>
                <Button asChild variant="outline" className="flex-1">
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
