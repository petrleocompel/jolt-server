import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "#/components/ui/badge";
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

  if (events.length === 0) {
    return <p className="text-muted-foreground text-sm">No pokes yet.</p>;
  }

  return (
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
              {event.stimulus.kind} · {event.stimulus.intensity}% · x{event.stimulus.repetitions}
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(event.status)}>{event.status}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
