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

const PUSH_MODES = {
  apns: "APNs",
  relay: "Push relay",
  console: "Console only",
} as const;

const REGISTRATION_LABELS = {
  unregistered: "not registered yet",
  registered: "registered",
  blocked: "blocked by the relay",
  failed: "registration failed",
} as const;

function AdminOverview() {
  const data = Route.useLoaderData();
  const { push } = data;

  const stats: Array<{ label: string; value: number; icon: LucideIcon }> = [
    { label: "Users", value: data.users, icon: Users },
    { label: "Active devices", value: data.activeDevices, icon: Smartphone },
    { label: "Pokes", value: data.pokes, icon: Send },
  ];

  return (
    <div className="flex flex-col gap-6">
      {push.mode === "console" && (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/40 p-4 text-sm">
          <strong>Push is not configured.</strong> Pokes are recorded and logged by
          ConsolePushSender, but nothing reaches a device. Set <code>PUSH_RELAY_URL</code> to
          deliver through the push relay, or <code>APNS_KEY_ID</code>, <code>APNS_TEAM_ID</code>{" "}
          and <code>APNS_KEY_P8</code> for your own build of the app.
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Push delivery</CardTitle>
          <Badge variant={push.mode === "console" ? "outline" : "default"}>
            {PUSH_MODES[push.mode]}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {push.relay ? (
            <>
              {push.mode !== "relay" && (
                <p className="text-muted-foreground">
                  Apps register directly with APNs, but devices that registered with the relay are
                  still delivered through it.
                </p>
              )}
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Relay</dt>
                <dd className="font-mono text-xs break-all">{push.relay.url}</dd>
                <dt className="text-muted-foreground">Server ID</dt>
                <dd className="font-mono text-xs break-all">{push.relay.serverId ?? "unavailable"}</dd>
                <dt className="text-muted-foreground">Registration</dt>
                <dd>
                  <Badge variant={push.relay.registration === "registered" ? "default" : "outline"}>
                    {REGISTRATION_LABELS[push.relay.registration]}
                  </Badge>
                  {push.relay.registeredAt && (
                    <span className="text-muted-foreground ml-2">
                      since {new Date(push.relay.registeredAt).toLocaleString()}
                    </span>
                  )}
                </dd>
                {push.relay.limits && (
                  <>
                    <dt className="text-muted-foreground">Daily limits</dt>
                    <dd>
                      {push.relay.limits.perRegistrationPerDay} per device,{" "}
                      {push.relay.limits.perServerPerDay} per server
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">Last error</dt>
                <dd>
                  {push.relay.lastError ? (
                    <>
                      <span className="text-destructive">{push.relay.lastError.message}</span>
                      <span className="text-muted-foreground ml-2">
                        {new Date(push.relay.lastError.at).toLocaleString()}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">none</span>
                  )}
                </dd>
              </dl>
              <p className="text-muted-foreground">
                The server registers with the relay on its first push, or when an app asks how to
                register. This is what this process has seen since it started.
              </p>
            </>
          ) : push.mode === "apns" ? (
            <p className="text-muted-foreground">
              Pushes go straight to Apple with this server's own credentials.
            </p>
          ) : (
            <p className="text-muted-foreground">No push transport is configured.</p>
          )}
        </CardContent>
      </Card>

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
        never acking — check the Devices tab, and the push delivery settings above.
      </p>
    </div>
  );
}
