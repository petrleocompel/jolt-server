import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, Inbox, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { fetchFriends, fetchRequests } from "#/server/friends";
import { fetchActivity } from "#/server/pokes";

export const Route = createFileRoute("/dashboard/")({
  loader: async () => ({
    friends: await fetchFriends(),
    requests: await fetchRequests(),
    activity: await fetchActivity({ data: { limit: 5 } }),
  }),
  component: Overview,
});

function Overview() {
  const { friends, requests, activity } = Route.useLoaderData();

  const stats: Array<{ label: string; value: number; icon: LucideIcon }> = [
    { label: "Friends", value: friends.length, icon: Users },
    { label: "Incoming requests", value: requests.incoming.length, icon: Inbox },
    { label: "Outgoing requests", value: requests.outgoing.length, icon: ArrowUpRight },
  ];

  return (
    <div className="flex flex-col gap-6">
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
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing yet.</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {activity.map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2">
                    {event.direction === "sent" ? (
                      <ArrowUpRight className="text-jolt-400 size-4 shrink-0" />
                    ) : (
                      <ArrowDownLeft className="text-jolt-400 size-4 shrink-0" />
                    )}
                    @{event.friendHandle} · {event.stimulus.kind} {event.stimulus.intensity}%
                  </span>
                  <span className="text-muted-foreground">{event.status}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
