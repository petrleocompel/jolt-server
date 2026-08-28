import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { fetchAllDevices, sendTestPoke } from "#/server/admin";

export const Route = createFileRoute("/admin/devices")({
  loader: () => fetchAllDevices(),
  component: AdminDevices,
});

function AdminDevices() {
  const devices = Route.useLoaderData();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  async function test(userId: string) {
    setBusyUser(userId);
    setMessage(null);
    try {
      const result = await sendTestPoke({
        data: { userId, stimulus: { kind: "vibe", intensity: 20, repetitions: 1 } },
      });
      setMessage(`${result.message} Delivered to ${result.sent} device(s), ${result.dead} dead.`);
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Test poke failed.");
    } finally {
      setBusyUser(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        A test poke bypasses friendship and permission checks — it exists to isolate APNs delivery
        from the permission logic.
      </p>
      {message && <p className="text-sm">{message}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Token</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead>State</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {devices.map((device) => (
            <TableRow key={device.id}>
              <TableCell>@{device.handle}</TableCell>
              <TableCell className="font-mono text-xs">{device.token.slice(0, 16)}…</TableCell>
              <TableCell>{device.platform}</TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">
                {new Date(device.lastSeenAt).toLocaleString()}
              </TableCell>
              <TableCell>
                {device.disabledAt ? (
                  <Badge variant="outline">unregistered</Badge>
                ) : (
                  <Badge>active</Badge>
                )}
              </TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(device.disabledAt) || busyUser === device.userId}
                  onClick={() => test(device.userId)}
                >
                  {busyUser === device.userId ? "Sending…" : "Test poke"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
