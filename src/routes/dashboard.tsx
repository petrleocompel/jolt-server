import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import { authClient } from "#/auth/client";
import { Button } from "#/components/ui/button";
import { fetchSession } from "#/server/session";

export const Route = createFileRoute("/dashboard")({
  loader: () => fetchSession(),
  component: DashboardShell,
});

const TABS = [
  { to: "/dashboard", label: "Overview", exact: true },
  { to: "/dashboard/friends", label: "Friends" },
  { to: "/dashboard/requests", label: "Requests" },
  { to: "/dashboard/permissions", label: "Permissions" },
  { to: "/dashboard/activity", label: "Activity" },
  { to: "/dashboard/invite", label: "Invite" },
] as const;

function DashboardShell() {
  const session = Route.useLoaderData();
  const router = useRouter();

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-4 border-b px-6 py-4">
        <Link to="/" className="font-semibold">
          Jolt
        </Link>
        <nav className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              activeOptions={{ exact: "exact" in tab }}
              activeProps={{ className: "bg-muted text-foreground" }}
              className="text-muted-foreground rounded-md px-3 py-1.5 text-sm hover:bg-muted/60"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {session?.role === "admin" && (
            <Link to="/admin" className="text-muted-foreground text-sm underline">
              Admin
            </Link>
          )}
          <span className="text-muted-foreground text-sm">@{session?.handle}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await authClient.signOut();
              await router.navigate({ to: "/login" });
            }}
          >
            Log out
          </Button>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
