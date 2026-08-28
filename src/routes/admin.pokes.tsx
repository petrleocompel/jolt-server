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
import { fetchAllPokes } from "#/server/admin";

export const Route = createFileRoute("/admin/pokes")({
  loader: () => fetchAllPokes(),
  component: AdminPokes,
});

function AdminPokes() {
  const pokes = Route.useLoaderData();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>From</TableHead>
          <TableHead>Stimulus</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Acked</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pokes.map((poke) => (
          <TableRow key={poke.id}>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {new Date(poke.createdAt).toLocaleString()}
            </TableCell>
            <TableCell>@{poke.senderHandle}</TableCell>
            <TableCell>
              {poke.kind} · {poke.intensity}% · x{poke.repetitions}
            </TableCell>
            <TableCell>
              <Badge variant={poke.status === "fired" ? "default" : "outline"}>{poke.status}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {poke.ackedAt ? new Date(poke.ackedAt).toLocaleTimeString() : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
