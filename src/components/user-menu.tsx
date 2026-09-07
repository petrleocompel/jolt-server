import { Link, useRouter } from "@tanstack/react-router";
import { ChevronsUpDown, LogOut, ShieldCheck, LayoutDashboard } from "lucide-react";
import { authClient } from "#/auth/client";
import { Avatar, AvatarFallback } from "#/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import type { SessionUser } from "#/server/session";

function UserMenu({ session, section }: { session: SessionUser; section: "dashboard" | "admin" }) {
  const router = useRouter();
  if (!session) return null;

  const initial = session.handle[0]?.toUpperCase() ?? "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md p-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar>
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{session.displayName}</span>
          <span className="truncate text-xs text-sidebar-foreground/50">@{session.handle}</span>
        </div>
        <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/40" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{session.displayName}</span>
          <span className="text-xs font-normal text-muted-foreground">@{session.handle}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {session.role === "admin" && (
          <DropdownMenuItem asChild>
            {section === "admin" ? (
              <Link to="/dashboard">
                <LayoutDashboard /> Back to dashboard
              </Link>
            ) : (
              <Link to="/admin">
                <ShieldCheck /> Admin
              </Link>
            )}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          onSelect={async () => {
            await authClient.signOut();
            await router.navigate({ to: "/login" });
          }}
        >
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { UserMenu };
