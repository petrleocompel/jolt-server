import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { fetchActivity } from "#/server/pokes";
import type { PokeDeliveryStatus } from "#/api/schemas";

export const Route = createFileRoute("/dashboard/activity")({
  loader: () => fetchActivity({ data: { limit: 100 } }),
  component: Activity,
});

function statusVariant(status: PokeDeliveryStatus) {
  if (status === "fired") return "default" as const;
  if (status === "pending") return "secondary" as const;
  return "outline" as const;
}

function Activity() {
  const events = Route.useLoaderData();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-muted-foreground text-sm">No pokes yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Friend</TableHead>
                <TableHead>Stimulus</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {new Date(event.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{event.direction}</TableCell>
                  <TableCell>
                    {event.friendDisplayName}{" "}
                    <span className="text-muted-foreground">@{event.friendHandle}</span>
                  </TableCell>
                  <TableCell>
                    {event.stimulus.kind} · {event.stimulus.intensity}% · x
                    {event.stimulus.repetitions}
                    {event.viaApiToken && (
                      // The token's name is only ever sent to the person who
                      // owns it; a recipient just sees that it was automated.
                      <Badge variant="outline" className="ml-2">
                        {event.apiTokenName ? `via ${event.apiTokenName}` : "automation"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(event.status)}>{event.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
