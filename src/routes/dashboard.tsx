import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  Activity,
  Home,
  Inbox,
  ShieldCheck,
  Smartphone,
  UserPlus,
  Users,
} from "lucide-react";
import { AppShell } from "#/components/app-shell";
import { fetchSession } from "#/server/session";
import type { NavItem } from "#/components/app-shell";

export const Route = createFileRoute("/dashboard")({
  loader: () => fetchSession(),
  component: DashboardShell,
});

const NAV: Array<NavItem> = [
  { to: "/dashboard", label: "Overview", icon: Home, exact: true },
  { to: "/dashboard/friends", label: "Friends", icon: Users },
  { to: "/dashboard/requests", label: "Requests", icon: Inbox },
  { to: "/dashboard/permissions", label: "Permissions", icon: ShieldCheck },
  { to: "/dashboard/activity", label: "Activity", icon: Activity },
  { to: "/dashboard/invite", label: "Invite", icon: UserPlus },
  { to: "/dashboard/devices", label: "Devices", icon: Smartphone },
];

function DashboardShell() {
  const session = Route.useLoaderData();

  return (
    <AppShell nav={NAV} section="dashboard" session={session} title="Dashboard">
      <Outlet />
    </AppShell>
  );
}
