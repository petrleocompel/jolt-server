import { createFileRoute } from "@tanstack/react-router";
import { Send, Smartphone, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { fetchAdminOverview } from "#/server/admin";

export const Route = createFileRoute("/admin/")({
  loader: () => fetchAdminOverview(),
  component: AdminOverview,
});

function AdminOverview() {
  const data = Route.useLoaderData();

  const stats: Array<{ label: string; value: number; icon: LucideIcon }> = [
    { label: "Users", value: data.users, icon: Users },
    { label: "Active devices", value: data.activeDevices, icon: Smartphone },
    { label: "Pokes", value: data.pokes, icon: Send },
  ];

  return (
    <div className="flex flex-col gap-6">
      {!data.apnsConfigured && (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/40 p-4 text-sm">
          <strong>APNs is not configured.</strong> Pokes are recorded and logged by
          ConsolePushSender, but nothing reaches a device. Set <code>APNS_KEY_ID</code>,{" "}
          <code>APNS_TEAM_ID</code> and <code>APNS_KEY_P8</code> to enable delivery.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">
                {stat.label}
              </CardTitle>
              <stat.icon className="text-jolt-400 size-4" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Delivery status breakdown</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {data.breakdown.length === 0 ? (
            <p className="text-muted-foreground text-sm">No pokes recorded.</p>
          ) : (
            data.breakdown.map((row) => (
              <Badge key={row.status} variant="outline">
                {row.status}: {row.count}
              </Badge>
            ))
          )}
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-sm">
        A large or growing <code>pending</code> count means pushes are going out but devices are
        never acking — check the Devices tab and APNs credentials.
      </p>
    </div>
  );
}
