import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { fetchFriends, updatePermission } from "#/server/friends";
import type { Friend, StimulusKind, StimulusPermission } from "#/api/schemas";

export const Route = createFileRoute("/dashboard/permissions")({
  loader: () => fetchFriends(),
  component: Permissions,
});

const KINDS: Array<StimulusKind> = ["zap", "vibe", "beep"];

function Permissions() {
  const friends = Route.useLoaderData();

  if (friends.length === 0) {
    return <p className="text-muted-foreground text-sm">No friends to configure yet.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        These control what each friend may send <em>you</em>. Permissions are always edited from
        the granting side, and the server enforces them on every poke.
      </p>
      {friends.map((friend) => (
        <FriendPermissions key={friend.id} friend={friend} />
      ))}
    </div>
  );
}

function FriendPermissions({ friend }: { friend: Friend }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {friend.displayName}{" "}
          <span className="text-muted-foreground text-sm font-normal">@{friend.handle}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-3">
        {KINDS.map((kind) => (
          <PermissionEditor
            key={kind}
            friendId={friend.id}
            kind={kind}
            initial={friend.permissionsIGranted[kind]}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function PermissionEditor({
  friendId,
  kind,
  initial,
}: {
  friendId: string;
  kind: StimulusKind;
  initial: StimulusPermission;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save(next: StimulusPermission) {
    setValue(next);
    setSaving(true);
    try {
      await updatePermission({ data: { friendId, kind, permission: next } });
      await router.invalidate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <Label className="capitalize">{kind}</Label>
        <Switch
          checked={value.isAllowed}
          onCheckedChange={(isAllowed) => save({ ...value, isAllowed })}
        />
      </div>

      <div className="grid gap-1.5">
        <Label className="text-muted-foreground text-xs">Max intensity: {value.maxIntensity}%</Label>
        <Input
          type="range"
          min={0}
          max={100}
          value={value.maxIntensity}
          disabled={!value.isAllowed}
          onChange={(event) => setValue({ ...value, maxIntensity: Number(event.target.value) })}
          onMouseUp={() => save(value)}
          onTouchEnd={() => save(value)}
        />
      </div>

      <div className="grid gap-1.5">
        <Label className="text-muted-foreground text-xs">Cooldown (seconds)</Label>
        <Input
          type="number"
          min={0}
          value={value.cooldownSeconds}
          disabled={!value.isAllowed}
          onChange={(event) =>
            setValue({ ...value, cooldownSeconds: Math.max(0, Number(event.target.value)) })
          }
          onBlur={() => save(value)}
        />
      </div>

      {saving && <p className="text-muted-foreground text-xs">Saving…</p>}
    </div>
  );
}
