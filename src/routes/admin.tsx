import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { assertAdmin } from "#/server/admin";

export const Route = createFileRoute("/admin")({
  loader: () => assertAdmin(),
  component: AdminShell,
});

const TABS = [
  { to: "/admin", label: "Overview", exact: true },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/pokes", label: "Pokes" },
  { to: "/admin/devices", label: "Devices" },
] as const;

function AdminShell() {
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-4 border-b px-6 py-4">
        <Link to="/" className="font-semibold">
          Jolt <span className="text-muted-foreground font-normal">admin</span>
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
        <Link to="/dashboard" className="text-muted-foreground ml-auto text-sm underline">
          Back to dashboard
        </Link>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
