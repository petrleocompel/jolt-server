import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/auth/client";
import { JoltMark } from "#/components/jolt-mark";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });

    setBusy(false);
    if (result.error) {
      // Never leak whether the address exists.
      setError("Invalid email or password.");
      return;
    }
    await router.navigate({ to: "/dashboard" });
  }

  return (
    <main className="brand-glow flex min-h-screen flex-col items-center justify-center p-8">
      <Card className="w-full max-w-sm border-white/5">
        <CardHeader className="flex flex-col items-center gap-3 text-center">
          <JoltMark className="size-8" />
          <h1 className="text-xl font-semibold tracking-tight">Log in to Jolt</h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
                autoComplete="current-password"
                required
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={busy} className="mt-2">
              {busy ? "Logging in…" : "Log in"}
            </Button>
          </form>
          <p className="text-muted-foreground text-center text-sm">
            No account?{" "}
            <Link to="/signup" className="text-jolt-300 underline underline-offset-2">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
