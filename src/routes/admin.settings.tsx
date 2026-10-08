import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { useHydrated } from "#/lib/use-hydrated";
import { fetchServerSettings, updateAutomationConsentRequired } from "#/server/admin";

export const Route = createFileRoute("/admin/settings")({
  loader: () => fetchServerSettings(),
  component: AdminSettings,
});

const SOURCE_LABEL = {
  env: "locked by environment variable",
  admin: "set here",
  default: "default",
} as const;

function AdminSettings() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const hydrated = useHydrated();
  const policy = data.automationConsentRequired;
  const locked = policy.source === "env";

  // Turning consent on changes what existing grants mean, so it is asked
  // twice: the switch only opens the warning, the warning's button commits.
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(required: boolean) {
    setBusy(true);
    setError(null);
    try {
      await updateAutomationConsentRequired({ data: { required } });
      setConfirming(false);
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Automated pokes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          A poke sent with a personal access token — someone&apos;s script rather than the person —
          still needs the recipient&apos;s ordinary permission. This decides what happens when the
          recipient has not said whether that friend&apos;s <em>automations</em> may use it too.
          Each person can always allow or block automations per friend and stimulus; their
          explicit choice wins under either setting, and changing this never rewrites one.
        </p>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="grid gap-1">
            <Label htmlFor="automation-consent">Require consent for automated pokes</Label>
            <p className="text-muted-foreground text-xs">
              {policy.value
                ? "Blocked until the recipient allows them for that friend and stimulus."
                : "Allowed unless the recipient turns them off for that friend and stimulus."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline">{SOURCE_LABEL[policy.source]}</Badge>
            <Switch
              id="automation-consent"
              checked={policy.value || confirming}
              disabled={locked || busy || !hydrated}
              onCheckedChange={(on) => (on ? setConfirming(true) : void save(false))}
            />
          </div>
        </div>

        {locked && (
          <p className="text-muted-foreground text-sm">
            Locked by the <code>AUTOMATION_CONSENT_REQUIRED</code> environment variable. Change or
            unset it and restart to manage this here.
          </p>
        )}

        {confirming && !policy.value && (
          <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-3 rounded-lg border p-4 text-sm">
            <p>
              <strong>
                {data.unansweredAllowedGrants === 1
                  ? "1 permission"
                  : `${data.unansweredAllowedGrants} permissions`}
              </strong>{" "}
              currently let a friend&apos;s automations through only because nobody answered —
              they will stop accepting automated pokes immediately. Scripts that rely on them will
              start getting 403s until each recipient allows automations again.
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void save(true)}>
                {busy ? "Saving…" : "Require consent"}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}
