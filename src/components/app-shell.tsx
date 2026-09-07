import { Link, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { JoltMark } from "#/components/jolt-mark";
import { UserMenu } from "#/components/user-menu";
import { Badge } from "#/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "#/components/ui/sidebar";
import type { SessionUser } from "#/server/session";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

function AppShell({
  nav,
  section,
  session,
  title,
  children,
}: {
  nav: Array<NavItem>;
  section: "dashboard" | "admin";
  session: SessionUser;
  title: string;
  children: React.ReactNode;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const activeItem = nav.find((item) =>
    item.exact ? pathname === item.to : pathname.startsWith(item.to),
  );
  const heading = activeItem?.label ?? title;

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <Link to="/" className="flex items-center gap-2 px-1 py-1">
            <JoltMark className="size-5" />
            <span className="font-semibold tracking-tight">Jolt</span>
            {section === "admin" && (
              <Badge variant="outline" className="ml-auto border-jolt-400/30 text-jolt-300">
                Admin
              </Badge>
            )}
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild>
                    <Link
                      to={item.to}
                      activeOptions={{ exact: Boolean(item.exact) }}
                      activeProps={{
                        className: "bg-sidebar-accent text-sidebar-foreground",
                      }}
                    >
                      <item.icon />
                      {item.label}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <UserMenu session={session} section={section} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
          <SidebarTrigger />
          <p className="text-xs text-muted-foreground">{section === "admin" ? "Admin" : "Dashboard"}</p>
          <span className="text-muted-foreground/40">/</span>
          <h1 className="text-sm font-semibold text-foreground">{heading}</h1>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export { AppShell };
export type { NavItem };
