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
import { fetchAllPokes } from "#/server/admin";

export const Route = createFileRoute("/admin/pokes")({
  loader: () => fetchAllPokes(),
  component: AdminPokes,
});

function AdminPokes() {
  const pokes = Route.useLoaderData();

  return (
    <Card>
      <CardHeader>
        <CardTitle>All pokes</CardTitle>
      </CardHeader>
      <CardContent>
        {pokes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No pokes recorded.</p>
        ) : (
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
                  <TableCell>
                    @{poke.senderHandle}
                    {poke.source === "api_token" && (
                      <Badge variant="outline" className="ml-2">
                        API token
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {poke.kind} · {poke.intensity}% · x{poke.repetitions}
                  </TableCell>
                  <TableCell>
                    <Badge variant={poke.status === "fired" ? "default" : "outline"}>
                      {poke.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {poke.ackedAt ? new Date(poke.ackedAt).toLocaleTimeString() : "—"}
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
