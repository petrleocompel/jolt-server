import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { fetchFriends, fetchServerPolicies, updatePermission } from "#/server/friends";
import type { Friend, StimulusKind, StimulusPermission } from "#/api/schemas";

export const Route = createFileRoute("/dashboard/permissions")({
  loader: async () => {
    const [friends, policies] = await Promise.all([fetchFriends(), fetchServerPolicies()]);
    return { friends, consentRequired: policies.automationConsentRequired };
  },
  component: Permissions,
});

const KINDS: Array<StimulusKind> = ["zap", "vibe", "beep"];

function Permissions() {
  const { friends, consentRequired } = Route.useLoaderData();

  if (friends.length === 0) {
    return <p className="text-muted-foreground text-sm">No friends to configure yet.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        These control what each friend may send <em>you</em>. Permissions are always edited from
        the granting side, and the server enforces them on every poke.
      </p>
      <p className="text-muted-foreground text-sm">
        <strong>Automated pokes</strong> come from a friend&apos;s scripts (their API tokens), not
        from the friend in person. They need the same permission, and your separate yes:{" "}
        {consentRequired
          ? "on this server they are blocked until you allow them."
          : "on this server they are allowed unless you block them."}{" "}
        &ldquo;Default&rdquo; follows that rule — if the server changes it, so does every default
        you left, while an explicit Allow or Block stays as you set it.
      </p>
      {friends.map((friend) => (
        <FriendPermissions key={friend.id} friend={friend} consentRequired={consentRequired} />
      ))}
    </div>
  );
}

function FriendPermissions({
  friend,
  consentRequired,
}: {
  friend: Friend;
  consentRequired: boolean;
}) {
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
            consentRequired={consentRequired}
          />
        ))}
      </CardContent>
    </Card>
  );
}

/** The three answers to "may their automations send me this?". */
const AUTOMATION_CHOICES: Array<{ label: string; value: boolean | null }> = [
  { label: "Default", value: null },
  { label: "Allow", value: true },
  { label: "Block", value: false },
];

function PermissionEditor({
  friendId,
  kind,
  initial,
  consentRequired,
}: {
  friendId: string;
  kind: StimulusKind;
  initial: StimulusPermission;
  consentRequired: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  // Derived here rather than read from `value`, which only refreshes from
  // the server on the next load: the label must follow a click at once.
  const automationEffective = value.automationAllowed ?? !consentRequired;

  async function save(next: StimulusPermission) {
    setValue(next);
    setSaving(true);
    try {
      const { isAllowed, maxIntensity, cooldownSeconds, automationAllowed } = next;
      await updatePermission({
        data: {
          friendId,
          kind,
          permission: { isAllowed, maxIntensity, cooldownSeconds, automationAllowed },
        },
      });
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

      <div className="grid gap-1.5">
        <Label className="text-muted-foreground text-xs">Automated pokes</Label>
        <div className="flex gap-1">
          {AUTOMATION_CHOICES.map((choice) => (
            <Button
              key={choice.label}
              type="button"
              size="sm"
              variant={value.automationAllowed === choice.value ? "default" : "outline"}
              onClick={() => save({ ...value, automationAllowed: choice.value })}
            >
              {choice.label}
            </Button>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          {!value.isAllowed
            ? "Off along with the stimulus itself."
            : automationEffective
              ? `Allowed${value.automationAllowed === null ? " (server default)" : ""}.`
              : `Blocked${value.automationAllowed === null ? " (server default)" : ""}.`}
        </p>
      </div>

      {saving && <p className="text-muted-foreground text-xs">Saving…</p>}
    </div>
  );
}
