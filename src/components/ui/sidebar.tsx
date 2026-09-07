import * as React from "react"
import { Slot } from "radix-ui"
import { Menu } from "lucide-react"

import { cn } from "#/lib/utils.ts"
import { Button } from "#/components/ui/button.tsx"
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "#/components/ui/sheet.tsx"

/**
 * A trimmed take on shadcn's sidebar block: fixed on desktop, a Sheet drawer
 * on mobile. Deliberately skips the parts this app doesn't need — icon-only
 * collapse mode, cookie-persisted state, the cmd+B shortcut.
 */

type SidebarContextValue = {
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider")
  return context
}

function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [openMobile, setOpenMobile] = React.useState(false)
  const value = React.useMemo(() => ({ openMobile, setOpenMobile }), [openMobile])

  return (
    <SidebarContext.Provider value={value}>
      <div className="flex min-h-screen w-full">{children}</div>
    </SidebarContext.Provider>
  )
}

function Sidebar({ children }: { children: React.ReactNode }) {
  const { openMobile, setOpenMobile } = useSidebar()

  return (
    <>
      <div
        data-slot="sidebar"
        className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
      >
        {children}
      </div>
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Site navigation</SheetDescription>
          <div className="flex h-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function SidebarTrigger({ className }: { className?: string }) {
  const { setOpenMobile } = useSidebar()
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("md:hidden", className)}
      onClick={() => setOpenMobile(true)}
    >
      <Menu />
      <span className="sr-only">Open navigation</span>
    </Button>
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-inset"
      className={cn("flex min-h-screen flex-1 flex-col md:pl-64", className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn("mt-auto flex flex-col gap-2 border-t border-sidebar-border p-4", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn("flex flex-1 flex-col gap-4 overflow-y-auto px-2 py-2", className)}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sidebar-group" className={cn("flex flex-col gap-1", className)} {...props} />
  )
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        "px-2.5 pb-1 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul data-slot="sidebar-menu" className={cn("flex flex-col gap-0.5", className)} {...props} />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" className={cn(className)} {...props} />
}

function SidebarMenuButton({
  className,
  isActive = false,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { isActive?: boolean; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-sidebar-foreground/70 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&_svg]:size-4 [&_svg]:shrink-0",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  SidebarProvider,
  Sidebar,
  SidebarTrigger,
  SidebarInset,
  SidebarHeader,
  SidebarFooter,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
}
