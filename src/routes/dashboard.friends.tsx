import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Badge } from "#/components/ui/badge";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { fetchFriends, removeFriend } from "#/server/friends";
import { submitPoke } from "#/server/pokes";
import type { Friend, StimulusKind } from "#/api/schemas";

export const Route = createFileRoute("/dashboard/friends")({
  loader: () => fetchFriends(),
  component: Friends,
});

const KINDS: Array<StimulusKind> = ["zap", "vibe", "beep"];

function Friends() {
  const friends = Route.useLoaderData();
  const router = useRouter();

  if (friends.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No friends yet — send a request from the Requests tab.
      </p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {friends.map((friend) => (
        <FriendCard key={friend.id} friend={friend} onChange={() => router.invalidate()} />
      ))}
    </div>
  );
}

function FriendCard({ friend, onChange }: { friend: Friend; onChange: () => void }) {
  const [message, setMessage] = useState<string | null>(null);

  // What they let *you* send drives the composer, so a disallowed stimulus is
  // never offered in the first place.
  const allowed = KINDS.filter((kind) => friend.permissionsGrantedToMe[kind].isAllowed);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>
            {friend.displayName}{" "}
            <span className="text-muted-foreground text-sm font-normal">@{friend.handle}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await removeFriend({ data: { friendId: friend.id } });
              onChange();
            }}
          >
            Unfriend
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {KINDS.map((kind) => {
            const grant = friend.permissionsGrantedToMe[kind];
            return (
              <Badge key={kind} variant={grant.isAllowed ? "default" : "outline"}>
                {kind} {grant.isAllowed ? `≤${grant.maxIntensity}%` : "off"}
              </Badge>
            );
          })}
        </div>

        {allowed.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            They haven&apos;t allowed you to send anything yet.
          </p>
        ) : (
          <PokeComposer
            friend={friend}
            allowed={allowed}
            onSent={(text) => {
              setMessage(text);
              onChange();
            }}
          />
        )}
        {message && <p className="text-muted-foreground text-sm">{message}</p>}
      </CardContent>
    </Card>
  );
}

function PokeComposer({
  friend,
  allowed,
  onSent,
}: {
  friend: Friend;
  allowed: Array<StimulusKind>;
  onSent: (message: string) => void;
}) {
  const [kind, setKind] = useState<StimulusKind>(allowed[0]!);
  const cap = friend.permissionsGrantedToMe[kind].maxIntensity;
  const [intensity, setIntensity] = useState(Math.min(30, cap));
  const [repetitions, setRepetitions] = useState(1);
  const [busy, setBusy] = useState(false);

  // Clamping here is UX only — the server re-checks and is authoritative.
  const clamped = Math.min(intensity, cap);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await submitPoke({
            data: { friendId: friend.id, stimulus: { kind, intensity: clamped, repetitions } },
          });
          onSent(`Sent ${kind} at ${clamped}%.`);
        } catch (error) {
          onSent(error instanceof Error ? error.message : "Could not send.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex gap-2">
        {allowed.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={option === kind ? "default" : "outline"}
            onClick={() => {
              setKind(option);
              setIntensity((current) =>
                Math.min(current, friend.permissionsGrantedToMe[option].maxIntensity),
              );
            }}
          >
            {option}
          </Button>
        ))}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`intensity-${friend.id}`}>
          Intensity: {clamped}% <span className="text-muted-foreground">(cap {cap}%)</span>
        </Label>
        <Input
          id={`intensity-${friend.id}`}
          type="range"
          min={0}
          max={cap}
          value={clamped}
          onChange={(event) => setIntensity(Number(event.target.value))}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`reps-${friend.id}`}>Repetitions: {repetitions}</Label>
        <Input
          id={`reps-${friend.id}`}
          type="range"
          min={1}
          max={5}
          value={repetitions}
          onChange={(event) => setRepetitions(Number(event.target.value))}
        />
      </div>

      <Button type="submit" disabled={busy}>
        {busy ? "Sending…" : `Send ${kind}`}
      </Button>
    </form>
  );
}
