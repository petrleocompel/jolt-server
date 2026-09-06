import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { fetchMyDevices, fetchTestPushStatus, sendMyTestPush } from "#/server/devices";
import type { StimulusConfig, StimulusKind, TestPushStatus } from "#/api/schemas";

export const Route = createFileRoute("/dashboard/devices")({
  loader: () => fetchMyDevices(),
  component: Devices,
});

const KINDS: Array<StimulusKind> = ["zap", "vibe", "beep"];

/** How long to wait for a device to confirm before calling it undelivered. */
const CONFIRM_WINDOW_MS = 30_000;

const DEFAULT_STIMULUS: StimulusConfig = { kind: "vibe", intensity: 20, repetitions: 1 };

function Devices() {
  const devices = Route.useLoaderData();
  const router = useRouter();

  const [withStimulus, setWithStimulus] = useState(false);
  const [stimulus, setStimulus] = useState<StimulusConfig>(DEFAULT_STIMULUS);
  const [test, setTest] = useState<TestPushStatus | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Acks arrive out of band, so the only way to see them is to ask again.
  // Stops at the confirmation window rather than running forever — an
  // unconfirmed test is itself the diagnostic.
  useEffect(() => {
    if (!test || Date.now() > deadline) return;
    const timer = setTimeout(() => {
      void fetchTestPushStatus({ data: { testID: test.testID } })
        .then(setTest)
        // A 404 here means the record expired; the last state we have is
        // still the useful one, so leave it on screen.
        .catch(() => setDeadline(0));
    }, 1000);
    return () => clearTimeout(timer);
  }, [test, deadline]);

  async function send(deviceId?: string) {
    setBusy(deviceId ?? "all");
    setError(null);
    setTest(null);
    try {
      const status = await sendMyTestPush({
        data: { deviceId, stimulus: withStimulus ? stimulus : undefined },
      });
      setTest(status);
      setDeadline(Date.now() + CONFIRM_WINDOW_MS);
      // A send can disable a token APNs rejects — reload the table.
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the test push.");
    } finally {
      setBusy(null);
    }
  }

  const active = devices.filter((device) => device.isActive);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        Every phone signed in to this account. A test push takes the same route as a poke — Apple
        to your device — but carries no poke, so it never touches your friends or their
        permissions.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>What to send</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="with-stimulus">Also fire it on my Pavlok</Label>
              <p className="text-muted-foreground text-sm">
                Off sends a notification only, so delivery can be checked with nothing connected.
              </p>
            </div>
            <Switch id="with-stimulus" checked={withStimulus} onCheckedChange={setWithStimulus} />
          </div>

          {withStimulus && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label className="text-muted-foreground text-xs">Kind</Label>
                <div className="flex gap-1">
                  {KINDS.map((kind) => (
                    <Button
                      key={kind}
                      type="button"
                      size="sm"
                      variant={stimulus.kind === kind ? "default" : "outline"}
                      onClick={() => setStimulus({ ...stimulus, kind })}
                      className="capitalize"
                    >
                      {kind}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-muted-foreground text-xs">
                  Intensity: {stimulus.intensity}%
                </Label>
                <Input
                  type="range"
                  min={0}
                  max={100}
                  value={stimulus.intensity}
                  onChange={(event) =>
                    setStimulus({ ...stimulus, intensity: Number(event.target.value) })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-muted-foreground text-xs">Repetitions</Label>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={stimulus.repetitions}
                  onChange={(event) =>
                    setStimulus({
                      ...stimulus,
                      repetitions: Math.min(5, Math.max(1, Number(event.target.value))),
                    })
                  }
                />
              </div>
            </div>
          )}

          <div>
            <Button
              type="button"
              disabled={active.length === 0 || busy !== null}
              onClick={() => void send()}
            >
              {busy === "all" ? "Sending…" : `Send to all my devices (${active.length})`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {test && <TestResult test={test} deadline={deadline} />}

      {devices.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No devices registered yet. Sign in on the Jolt app and allow notifications — it registers
          itself on launch.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>State</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((device) => (
              <TableRow key={device.id}>
                <TableCell className="font-mono text-xs">…{device.tokenSuffix}</TableCell>
                <TableCell>{device.platform}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {new Date(device.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {new Date(device.lastSeenAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  {device.isActive ? <Badge>active</Badge> : <Badge variant="outline">unregistered</Badge>}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!device.isActive || busy !== null}
                    onClick={() => void send(device.id)}
                  >
                    {busy === device.id ? "Sending…" : "Send test"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

const PATH_LABEL: Record<string, string> = {
  alert: "notification tap",
  foreground: "banner in-app",
  background: "silent wake",
};

function TestResult({ test, deadline }: { test: TestPushStatus; deadline: number }) {
  // Recomputed on every poll, which is what makes the countdown move.
  const waiting = Date.now() < deadline;
  const accepted = test.devices.filter((device) => device.ok);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test {test.testID.slice(0, 8)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!test.apnsConfigured && (
          <p className="text-destructive">
            This server has no Apple credentials, so the push was logged to the server console
            instead of delivered. No device will confirm it.
          </p>
        )}

        <ul className="flex flex-col gap-1">
          {test.devices.map((device) => {
            const acks = test.acks.filter((ack) => ack.deviceId === device.deviceId);
            return (
              <li key={device.deviceId} className="flex flex-wrap justify-between gap-x-4">
                <span className="font-mono text-xs">{device.deviceId.slice(0, 8)}</span>
                <span>
                  {!device.ok ? (
                    <span className="text-destructive">
                      APNs rejected it — {device.reason}
                      {device.detail ? ` (${device.detail})` : ""}
                    </span>
                  ) : acks.length > 0 ? (
                    acks
                      .map(
                        (ack) =>
                          `delivered in ${(ack.elapsedMs / 1000).toFixed(1)}s ` +
                          `(${PATH_LABEL[ack.path] ?? ack.path}` +
                          `${ack.status ? `, ${ack.status}` : ""})`,
                      )
                      .join(" · ")
                  ) : waiting ? (
                    <span className="text-muted-foreground">
                      APNs accepted it — waiting for the device…
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      No confirmation. The app may not be installed, notifications may be off, or
                      iOS throttled the push.
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {accepted.length > 0 && waiting && test.acks.length === 0 && (
          <p className="text-muted-foreground text-xs">
            A locked phone usually confirms within a second or two. The silent half can take much
            longer — iOS schedules those at its own convenience.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
