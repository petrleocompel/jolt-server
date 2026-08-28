import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import { fetchSession } from "#/server/session";

export const Route = createFileRoute("/")({
  loader: () => fetchSession(),
  component: Home,
});

function Home() {
  const session = Route.useLoaderData();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Jolt Server</h1>
        <p className="text-muted-foreground mt-2 text-lg">
          Accounts, friends, per-stimulus permissions and pokes for the Jolt iOS app.
        </p>
      </div>

      <div className="flex gap-3">
        {session ? (
          <>
            <Button asChild>
              <Link to="/dashboard">Dashboard</Link>
            </Button>
            {session.role === "admin" && (
              <Button asChild variant="outline">
                <Link to="/admin">Admin</Link>
              </Button>
            )}
          </>
        ) : (
          <>
            <Button asChild>
              <Link to="/login">Log in</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/signup">Sign up</Link>
            </Button>
          </>
        )}
      </div>

      <p className="text-muted-foreground text-sm">
        API contract: <code className="text-foreground">openapi/jolt-v1.yaml</code> — served
        under <code className="text-foreground">/api/v1</code>.
      </p>
    </main>
  );
}
