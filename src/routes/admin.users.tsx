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
import { fetchAllUsers } from "#/server/admin";

export const Route = createFileRoute("/admin/users")({
  loader: () => fetchAllUsers(),
  component: AdminUsers,
});

function AdminUsers() {
  const users = Route.useLoaderData();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Handle</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Invite code</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Joined</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell>@{user.handle}</TableCell>
            <TableCell>{user.name}</TableCell>
            <TableCell className="text-muted-foreground">{user.email}</TableCell>
            <TableCell className="font-mono text-xs">{user.inviteCode}</TableCell>
            <TableCell>
              {user.role === "admin" ? <Badge>admin</Badge> : <span className="text-muted-foreground">user</span>}
            </TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {new Date(user.createdAt).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
