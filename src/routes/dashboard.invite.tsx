import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { qrForInvite } from "#/server/admin";

export const Route = createFileRoute("/dashboard/invite")({
  loader: () => qrForInvite(),
  component: Invite,
});

function Invite() {
  const { handle, inviteCode, dataUrl } = Route.useLoaderData();

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Your invite</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <img src={dataUrl} alt={`QR code for invite ${inviteCode}`} className="rounded-lg border" />
        <div className="text-center">
          <p className="font-mono text-lg">{inviteCode}</p>
          <p className="text-muted-foreground text-sm">or add by handle: @{handle}</p>
        </div>
        <p className="text-muted-foreground text-center text-xs">
          Share this out-of-band. There is no user search — a code or an exact handle is the only
          way someone can send you a request.
        </p>
      </CardContent>
    </Card>
  );
}
