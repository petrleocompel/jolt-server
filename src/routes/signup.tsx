import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/auth/client";
import { JoltMark } from "#/components/jolt-mark";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useHydrated } from "#/lib/use-hydrated";

export const Route = createFileRoute("/signup")({ component: Signup });

function Signup() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await authClient.signUp.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
      name: String(form.get("displayName")),
      handle: String(form.get("handle")).toLowerCase(),
    });

    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Could not create the account.");
      return;
    }
    await router.navigate({ to: "/dashboard" });
  }

  return (
    <main className="brand-glow flex min-h-screen flex-col items-center justify-center p-8">
      <Card className="w-full max-w-sm border-white/5">
        <CardHeader className="flex flex-col items-center gap-3 text-center">
          <JoltMark className="size-8" />
          <h1 className="text-xl font-semibold tracking-tight">Create an account</h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form onSubmit={onSubmit} method="post" className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input id="displayName" name="displayName" maxLength={50} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="handle">Handle</Label>
              <Input
                id="handle"
                name="handle"
                pattern="[a-z0-9_]{3,20}"
                placeholder="lowercase, 3–20 chars"
                required
              />
              <p className="text-muted-foreground text-xs">
                There is no search — this is how friends find you.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                minLength={8}
                autoComplete="new-password"
                required
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={busy || !hydrated} className="mt-2">
              {busy ? "Creating…" : "Sign up"}
            </Button>
          </form>
          <p className="text-muted-foreground text-center text-sm">
            Already have one?{" "}
            <Link to="/login" className="text-jolt-300 underline underline-offset-2">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
