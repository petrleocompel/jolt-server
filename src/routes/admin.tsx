import { createFileRoute, Outlet } from "@tanstack/react-router";
import { LayoutDashboard, Send, Smartphone, Users } from "lucide-react";
import { AppShell } from "#/components/app-shell";
import { assertAdmin } from "#/server/admin";
import { fetchSession } from "#/server/session";
import type { NavItem } from "#/components/app-shell";

export const Route = createFileRoute("/admin")({
  loader: async () => {
    await assertAdmin();
    return fetchSession();
  },
  component: AdminShell,
});

const NAV: Array<NavItem> = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/pokes", label: "Pokes", icon: Send },
  { to: "/admin/devices", label: "Devices", icon: Smartphone },
];

function AdminShell() {
  const session = Route.useLoaderData();

  return (
    <AppShell nav={NAV} section="admin" session={session} title="Admin">
      <Outlet />
    </AppShell>
  );
}
