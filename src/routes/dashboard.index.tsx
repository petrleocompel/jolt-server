import { createFileRoute } from "@tanstack/react-router";
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

  const stats = [
    { label: "Friends", value: friends.length },
    { label: "Incoming requests", value: requests.incoming.length },
    { label: "Outgoing requests", value: requests.outgoing.length },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">
                {stat.label}
              </CardTitle>
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
            <ul className="flex flex-col gap-2 text-sm">
              {activity.map((event) => (
                <li key={event.id} className="flex justify-between gap-4">
                  <span>
                    {event.direction === "sent" ? "You →" : "←"} @{event.friendHandle} ·{" "}
                    {event.stimulus.kind} {event.stimulus.intensity}%
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
