import { expect, test  } from "@playwright/test";
import type {APIRequestContext} from "@playwright/test";

/**
 * Walks the whole mobile contract against a real server and a real Postgres:
 * signup -> friend request -> accept -> grant permission -> poke -> ack.
 * This is the test that catches spec violations the type system cannot, and
 * the reason the e2e stack is worth having.
 */

const API = "/api/v1";
const unique = () => Math.random().toString(36).slice(2, 10);

async function signup(request: APIRequestContext, handle: string) {
  const response = await request.post(`${API}/auth/signup`, {
    data: {
      email: `${handle}@example.test`,
      password: "correct-horse-battery",
      handle,
      displayName: handle.toUpperCase(),
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.token).toBeTruthy();
  expect(body.user.inviteCode).toMatch(/^JOLT-/);
  return body as { token: string; user: { id: string; handle: string; inviteCode: string } };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test("full poke lifecycle", async ({ request }) => {
  let pokeId = "";
  const alice = await signup(request, `alice${unique()}`);
  const bob = await signup(request, `bob${unique()}`);

  await test.step("unauthenticated requests are rejected", async () => {
    expect((await request.get(`${API}/friends`)).status()).toBe(401);
  });

  await test.step("alice requests bob by handle", async () => {
    const response = await request.post(`${API}/friends/requests`, {
      headers: auth(alice.token),
      data: { handle: bob.user.handle },
    });
    expect(response.status()).toBe(201);
    expect((await response.json()).direction).toBe("outgoing");
  });

  await test.step("a duplicate request is a 409", async () => {
    const response = await request.post(`${API}/friends/requests`, {
      headers: auth(alice.token),
      data: { handle: bob.user.handle },
    });
    expect(response.status()).toBe(409);
  });

  await test.step("an unknown handle is a 404", async () => {
    const response = await request.post(`${API}/friends/requests`, {
      headers: auth(alice.token),
      data: { handle: `nobody${unique()}` },
    });
    expect(response.status()).toBe(404);
  });

  let requestId = "";
  await test.step("bob sees it as incoming", async () => {
    const response = await request.get(`${API}/friends/requests`, { headers: auth(bob.token) });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.incoming).toHaveLength(1);
    expect(body.outgoing).toHaveLength(0);
    requestId = body.incoming[0].id;
  });

  await test.step("accepting starts every stimulus disabled", async () => {
    const response = await request.post(`${API}/friends/requests/${requestId}/accept`, {
      headers: auth(bob.token),
    });
    expect(response.status()).toBe(200);
    const friend = await response.json();
    for (const kind of ["zap", "vibe", "beep"] as const) {
      expect(friend.permissionsIGranted[kind].isAllowed).toBe(false);
      expect(friend.permissionsGrantedToMe[kind].isAllowed).toBe(false);
    }
  });

  await test.step("poking without a grant is a 403", async () => {
    const response = await request.post(`${API}/pokes`, {
      headers: auth(alice.token),
      data: { friendId: bob.user.id, stimulus: { kind: "zap", intensity: 10, repetitions: 1 } },
    });
    expect(response.status()).toBe(403);
  });

  await test.step("bob grants alice zap up to 40%", async () => {
    const response = await request.put(
      `${API}/friends/${alice.user.id}/permissions/zap`,
      {
        headers: auth(bob.token),
        data: { isAllowed: true, maxIntensity: 40, cooldownSeconds: 0 },
      },
    );
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ isAllowed: true, maxIntensity: 40 });
  });

  await test.step("intensity above the cap is still a 403", async () => {
    const response = await request.post(`${API}/pokes`, {
      headers: auth(alice.token),
      data: { friendId: bob.user.id, stimulus: { kind: "zap", intensity: 90, repetitions: 1 } },
    });
    expect(response.status()).toBe(403);
  });

  await test.step("a permitted poke is accepted as pending", async () => {
    const response = await request.post(`${API}/pokes`, {
      headers: auth(alice.token),
      data: { friendId: bob.user.id, stimulus: { kind: "zap", intensity: 30, repetitions: 2 } },
    });
    expect(response.status()).toBe(201);
    const poke = await response.json();
    expect(poke.status).toBe("pending");
    expect(poke.direction).toBe("sent");
    expect(poke.ackedAt).toBeNull();
    pokeId = poke.id;
  });

  await test.step("bob's device acks it, idempotently", async () => {
    const first = await request.post(`${API}/pokes/${pokeId}/ack`, {
      headers: auth(bob.token),
      data: { status: "fired" },
    });
    expect(first.status()).toBe(200);
    expect((await first.json()).status).toBe("fired");

    // A second ack (silent push, then notification tap) must not overwrite.
    const second = await request.post(`${API}/pokes/${pokeId}/ack`, {
      headers: auth(bob.token),
      data: { status: "deviceNotConnected" },
    });
    expect(second.status()).toBe(200);
    const settled = await second.json();
    expect(settled.status).toBe("fired");
    // Set by the first ack and unchanged by the second — the detail screen
    // reads this to say when a poke actually landed.
    expect(settled.ackedAt).not.toBeNull();
    expect(new Date(settled.ackedAt).getTime()).not.toBeNaN();
  });

  await test.step("both sides see the event, with opposite directions", async () => {
    const [sent, received] = await Promise.all([
      request.get(`${API}/pokes`, { headers: auth(alice.token) }),
      request.get(`${API}/pokes`, { headers: auth(bob.token) }),
    ]);
    expect((await sent.json())[0]).toMatchObject({ direction: "sent", status: "fired" });
    expect((await received.json())[0]).toMatchObject({ direction: "received", status: "fired" });
  });

  await test.step("a retry with the same pokeId is answered, not sent again", async () => {
    // The phone lost the connection after sending, and asks again. The retry
    // must land *inside* the cooldown the original started, and still be a
    // 200 — it is the same poke, not a new one.
    await request.put(`${API}/friends/${alice.user.id}/permissions/beep`, {
      headers: auth(bob.token),
      data: { isAllowed: true, maxIntensity: 100, cooldownSeconds: 300 },
    });
    const pokeId = crypto.randomUUID();
    const body = { friendId: bob.user.id, stimulus: { kind: "beep", intensity: 5, repetitions: 1 }, pokeId };

    const first = await request.post(`${API}/pokes`, { headers: auth(alice.token), data: body });
    expect(first.status()).toBe(201);
    expect((await first.json()).id).toBe(pokeId);

    const retry = await request.post(`${API}/pokes`, { headers: auth(alice.token), data: body });
    expect(retry.status()).toBe(200);
    expect((await retry.json()).id).toBe(pokeId);

    // Exactly one of it in the feed.
    const feed = await (await request.get(`${API}/pokes`, { headers: auth(alice.token) })).json();
    expect(feed.filter((e: { id: string }) => e.id === pokeId)).toHaveLength(1);

    // Someone else cannot claim it.
    const stolen = await request.post(`${API}/pokes`, {
      headers: auth(bob.token),
      data: { ...body, friendId: alice.user.id },
    });
    expect(stolen.status()).toBe(409);
  });

  await test.step("cooldown is enforced server-side", async () => {
    await request.put(`${API}/friends/${alice.user.id}/permissions/vibe`, {
      headers: auth(bob.token),
      data: { isAllowed: true, maxIntensity: 100, cooldownSeconds: 300 },
    });
    const body = {
      friendId: bob.user.id,
      stimulus: { kind: "vibe", intensity: 10, repetitions: 1 },
    };
    expect((await request.post(`${API}/pokes`, { headers: auth(alice.token), data: body })).status())
      .toBe(201);
    expect((await request.post(`${API}/pokes`, { headers: auth(alice.token), data: body })).status())
      .toBe(403);
  });

  await test.step("unfriending clears the relationship", async () => {
    const response = await request.delete(`${API}/friends/${bob.user.id}`, {
      headers: auth(alice.token),
    });
    expect(response.status()).toBe(204);
    expect(await (await request.get(`${API}/friends`, { headers: auth(alice.token) })).json())
      .toHaveLength(0);
  });
});


test("logout invalidates the token", async ({ request }) => {
  const user = await signup(request, `carol${unique()}`);

  expect((await request.get(`${API}/me`, { headers: auth(user.token) })).status()).toBe(200);
  expect((await request.post(`${API}/auth/logout`, { headers: auth(user.token) })).status()).toBe(204);
  // The contract says "invalidate", so the token must actually stop working.
  expect((await request.get(`${API}/me`, { headers: auth(user.token) })).status()).toBe(401);
});

test("login rejects a wrong password without leaking whether the email exists", async ({
  request,
}) => {
  const user = await signup(request, `dave${unique()}`);

  const wrongPassword = await request.post(`${API}/auth/login`, {
    data: { email: `${user.user.handle}@example.test`, password: "not-the-password" },
  });
  const noSuchUser = await request.post(`${API}/auth/login`, {
    data: { email: `ghost${unique()}@example.test`, password: "not-the-password" },
  });

  expect(wrongPassword.status()).toBe(401);
  expect(noSuchUser.status()).toBe(401);
  expect(await wrongPassword.json()).toEqual(await noSuchUser.json());
});

test("a personal access token drives the self-stimulus endpoint, and nothing else", async ({
  request,
}) => {
  const erin = await signup(request, `erin${unique()}`);
  let token = "";
  let tokenId = "";
  const pushToken = `e2e-${unique()}${unique()}`;

  await test.step("minting one returns the secret exactly once", async () => {
    const response = await request.post(`${API}/me/tokens`, {
      headers: auth(erin.token),
      data: { name: "home assistant", scopes: ["stimulus:self"] },
    });
    expect(response.status()).toBe(201);
    const created = await response.json();
    expect(created.token).toMatch(/^jolt_pat_/);
    expect(created).toMatchObject({ scopes: ["stimulus:self"], friendScope: "all", friendIds: [] });
    expect(created.lastUsedAt).toBeNull();
    expect(created.expiresAt).toBeNull();
    token = created.token;
    tokenId = created.id;

    const listed = await request.get(`${API}/me/tokens`, { headers: auth(erin.token) });
    const rows = await listed.json();
    expect(rows).toHaveLength(1);
    // Listing shows enough to recognise the row and nothing you could present.
    expect(rows[0].token).toBeUndefined();
    expect(token).toContain(rows[0].prefix);
  });

  await test.step("it authenticates the account that minted it", async () => {
    const response = await request.get(`${API}/me`, { headers: auth(token) });
    expect(response.status()).toBe(200);
    expect((await response.json()).handle).toBe(erin.user.handle);
  });

  await test.step("but reaches neither other people nor its own management", async () => {
    // 403, not 401: the token is fine, the endpoint is not.
    const friends = await request.get(`${API}/friends`, { headers: auth(token) });
    expect(friends.status()).toBe(403);
    expect((await friends.json()).message).toBe('This token lacks the "friends:read" scope.');
    // A token that could mint another would survive its own revocation.
    expect((await request.get(`${API}/me/tokens`, { headers: auth(token) })).status()).toBe(403);
  });

  await test.step("a self stimulus with no device to fire on is a 404", async () => {
    const response = await request.post(`${API}/me/stimulus`, {
      headers: auth(token),
      data: { stimulus: { kind: "vibe", intensity: 20, repetitions: 1 } },
    });
    expect(response.status()).toBe(404);
  });

  await test.step("a poke body sent here is a 400, not a stimulus at the caller", async () => {
    // `/me/stimulus` and `POST /pokes` differ by one field. Getting them
    // confused used to cost the caller a shock: the unknown `friendId` was
    // stripped and the stimulus fired at whoever held the credential.
    const response = await request.post(`${API}/me/stimulus`, {
      headers: auth(token),
      data: {
        friendId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        stimulus: { kind: "zap", intensity: 90, repetitions: 1 },
      },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).message).toContain("friendId");
  });

  await test.step("with a device it lands in the activity feed, acked as usual", async () => {
    const registered = await request.post(`${API}/devices/push-token`, {
      headers: auth(erin.token),
      data: { token: pushToken, platform: "ios" },
    });
    expect(registered.status()).toBe(204);

    const response = await request.post(`${API}/me/stimulus`, {
      headers: auth(token),
      data: { stimulus: { kind: "zap", intensity: 15, repetitions: 2 } },
    });
    expect(response.status()).toBe(201);
    const event = await response.json();
    expect(event).toMatchObject({
      direction: "sent",
      status: "pending",
      friendHandle: erin.user.handle,
      stimulus: { kind: "zap", intensity: 15, repetitions: 2 },
    });

    // Same ack endpoint as any other poke — it is a poke_event from you to you.
    const acked = await request.post(`${API}/pokes/${event.id}/ack`, {
      headers: auth(erin.token),
      data: { status: "fired" },
    });
    expect(acked.status()).toBe(200);
    expect((await acked.json()).status).toBe("fired");
  });

  await test.step("a looping script is held to one per second", async () => {
    const response = await request.post(`${API}/me/stimulus`, {
      headers: auth(token),
      data: { stimulus: { kind: "vibe", intensity: 10, repetitions: 1 } },
    });
    expect(response.status()).toBe(429);
  });

  await test.step("signing out forgets the device, so pokes stop arriving on it", async () => {
    // The row outlived the session before this endpoint existed: a phone that
    // had been signed in as someone else stayed a delivery target for that
    // account, and their pokes fired on a wrist that had nothing to do with
    // them.
    const forgotten = await request.delete(`${API}/devices/push-token`, {
      headers: auth(erin.token),
      data: { token: pushToken },
    });
    expect(forgotten.status()).toBe(204);

    const devices = await request.get(`${API}/devices`, { headers: auth(erin.token) });
    const suffix = pushToken.slice(-8);
    expect(
      (await devices.json()).some((d: { tokenSuffix: string }) => d.tokenSuffix === suffix),
    ).toBe(false);

    // Forgetting a token that is already gone is a no-op, not a 404 — a
    // sign-out that runs twice must not fail the second time.
    expect(
      (
        await request.delete(`${API}/devices/push-token`, {
          headers: auth(erin.token),
          data: { token: pushToken },
        })
      ).status(),
    ).toBe(204);
  });

  await test.step("revoking stops it working immediately", async () => {
    const revoked = await request.delete(`${API}/me/tokens/${tokenId}`, {
      headers: auth(erin.token),
    });
    expect(revoked.status()).toBe(204);
    expect((await request.get(`${API}/me`, { headers: auth(token) })).status()).toBe(401);
    // Revoking it twice 404s, exactly like an id that never existed.
    expect(
      (await request.delete(`${API}/me/tokens/${tokenId}`, { headers: auth(erin.token) })).status(),
    ).toBe(404);
  });
});

/** Makes two accounts friends: `from` asks, `to` accepts. */
async function befriend(
  request: APIRequestContext,
  from: { token: string },
  to: { token: string; user: { handle: string } },
) {
  const asked = await request.post(`${API}/friends/requests`, {
    headers: auth(from.token),
    data: { handle: to.user.handle },
  });
  expect(asked.status()).toBe(201);
  const incoming = (await (await request.get(`${API}/friends/requests`, { headers: auth(to.token) })).json())
    .incoming as Array<{ id: string }>;
  const accepted = await request.post(`${API}/friends/requests/${incoming[0]!.id}/accept`, {
    headers: auth(to.token),
  });
  expect(accepted.status()).toBe(200);
}

async function mint(request: APIRequestContext, owner: { token: string }, data: object) {
  const response = await request.post(`${API}/me/tokens`, { headers: auth(owner.token), data });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; token: string };
}

test("a scoped token pokes only the friends it was minted for", async ({ request }) => {
  const alice = await signup(request, `alice${unique()}`);
  const bob = await signup(request, `bob${unique()}`);
  const carol = await signup(request, `carol${unique()}`);
  await befriend(request, alice, bob);
  await befriend(request, alice, carol);
  for (const friend of [bob, carol]) {
    const granted = await request.put(`${API}/friends/${alice.user.id}/permissions/vibe`, {
      headers: auth(friend.token),
      data: { isAllowed: true, maxIntensity: 80, cooldownSeconds: 0 },
    });
    expect(granted.status()).toBe(200);
  }
  const vibe = { kind: "vibe", intensity: 20, repetitions: 1 };

  const forBob = await mint(request, alice, {
    name: "bob only",
    scopes: ["pokes:send", "friends:read"],
    friendIds: [bob.user.id.toUpperCase()],
  });

  await test.step("it sees and pokes only the listed friend", async () => {
    const friends = await (await request.get(`${API}/friends`, { headers: auth(forBob.token) })).json();
    expect(friends.map((f: { id: string }) => f.id)).toEqual([bob.user.id]);

    const toBob = await request.post(`${API}/pokes`, {
      headers: auth(forBob.token),
      data: { friendId: bob.user.id, stimulus: vibe },
    });
    expect(toBob.status()).toBe(201);

    const toCarol = await request.post(`${API}/pokes`, {
      headers: auth(forBob.token),
      data: { friendId: carol.user.id, stimulus: vibe },
    });
    expect(toCarol.status()).toBe(403);
    expect((await toCarol.json()).message).toBe("This token isn't allowed to poke that friend.");
  });

  await test.step("and nothing its scopes leave out", async () => {
    const feed = await request.get(`${API}/pokes`, { headers: auth(forBob.token) });
    expect(feed.status()).toBe(403);
    expect((await feed.json()).message).toBe('This token lacks the "pokes:read" scope.');
    const self = await request.post(`${API}/me/stimulus`, {
      headers: auth(forBob.token),
      data: { stimulus: vibe },
    });
    expect(self.status()).toBe(403);
    // Session-only, whatever the scopes.
    expect(
      (await request.get(`${API}/friends/requests`, { headers: auth(forBob.token) })).status(),
    ).toBe(403);
  });

  await test.step("a wildcard token reaches every friend and every read", async () => {
    const everything = await mint(request, alice, { name: "all", scopes: ["*"] });
    const friends = await (await request.get(`${API}/friends`, { headers: auth(everything.token) })).json();
    expect(friends).toHaveLength(2);
    const feed = await request.get(`${API}/pokes`, { headers: auth(everything.token) });
    expect(feed.status()).toBe(200);
  });

  await test.step("a reader with a list sees only those friends' pokes", async () => {
    // carol pokes alice so there is an event with someone off the list.
    const grant = await request.put(`${API}/friends/${carol.user.id}/permissions/vibe`, {
      headers: auth(alice.token),
      data: { isAllowed: true, maxIntensity: 80, cooldownSeconds: 0 },
    });
    expect(grant.status()).toBe(200);
    expect(
      (
        await request.post(`${API}/pokes`, {
          headers: auth(carol.token),
          data: { friendId: alice.user.id, stimulus: vibe },
        })
      ).status(),
    ).toBe(201);

    const reader = await mint(request, alice, {
      name: "bob feed",
      scopes: ["pokes:read"],
      friendIds: [bob.user.id],
    });
    const feed = await (await request.get(`${API}/pokes`, { headers: auth(reader.token) })).json();
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.every((e: { friendHandle: string }) => e.friendHandle === bob.user.handle)).toBe(
      true,
    );
  });

  await test.step("an empty list reaches nobody", async () => {
    const nobody = await mint(request, alice, {
      name: "nobody",
      scopes: ["pokes:send", "friends:read"],
      friendIds: [],
    });
    expect(await (await request.get(`${API}/friends`, { headers: auth(nobody.token) })).json())
      .toEqual([]);
  });

  await test.step("a stranger cannot be put on the list", async () => {
    const stranger = await signup(request, `dave${unique()}`);
    const response = await request.post(`${API}/me/tokens`, {
      headers: auth(alice.token),
      data: { name: "nope", scopes: ["pokes:send"], friendIds: [stranger.user.id] },
    });
    expect(response.status()).toBe(400);
  });

  await test.step("unfriending empties the list for good", async () => {
    expect(
      (await request.delete(`${API}/friends/${bob.user.id}`, { headers: auth(alice.token) })).status(),
    ).toBe(204);
    const tokens = await (await request.get(`${API}/me/tokens`, { headers: auth(alice.token) })).json();
    expect(tokens.find((t: { id: string }) => t.id === forBob.id)).toMatchObject({
      friendScope: "selected",
      friendIds: [],
    });

    // Friends again — but the token stays aimed at nobody.
    await befriend(request, alice, bob);
    await request.put(`${API}/friends/${alice.user.id}/permissions/vibe`, {
      headers: auth(bob.token),
      data: { isAllowed: true, maxIntensity: 80, cooldownSeconds: 0 },
    });
    const poke = await request.post(`${API}/pokes`, {
      headers: auth(forBob.token),
      data: { friendId: bob.user.id, stimulus: vibe },
    });
    expect(poke.status()).toBe(403);
  });
});

test("a token's own limits narrow the grant, and its interval holds under a burst", async ({
  request,
}) => {
  const alice = await signup(request, `alice${unique()}`);
  const bob = await signup(request, `bob${unique()}`);
  await befriend(request, alice, bob);
  for (const kind of ["zap", "vibe"]) {
    await request.put(`${API}/friends/${alice.user.id}/permissions/${kind}`, {
      headers: auth(bob.token),
      data: { isAllowed: true, maxIntensity: 80, cooldownSeconds: 0 },
    });
  }
  const limited = await mint(request, alice, {
    name: "gentle",
    scopes: ["pokes:send", "stimulus:self"],
    allowedKinds: ["vibe"],
    maxIntensity: 30,
    minIntervalSeconds: 60,
  });
  const poke = (stimulus: object, pokeId?: string) =>
    request.post(`${API}/pokes`, {
      headers: auth(limited.token),
      data: { friendId: bob.user.id, stimulus, ...(pokeId ? { pokeId } : {}) },
    });

  await test.step("a kind or intensity the token excludes is a 403, and costs nothing", async () => {
    const zap = await poke({ kind: "zap", intensity: 10, repetitions: 1 });
    expect(zap.status()).toBe(403);
    expect((await zap.json()).message).toBe("This token can't send zap.");

    // Bob allows 80; the token's own cap is lower, and wins.
    const hard = await poke({ kind: "vibe", intensity: 50, repetitions: 1 });
    expect(hard.status()).toBe(403);
    expect((await hard.json()).message).toBe("Intensity exceeds this token's cap of 30.");

    const self = await request.post(`${API}/me/stimulus`, {
      headers: auth(limited.token),
      data: { stimulus: { kind: "zap", intensity: 10, repetitions: 1 } },
    });
    expect(self.status()).toBe(403);
  });

  const pokeId = crypto.randomUUID();
  await test.step("the first allowed poke goes through — the refusals spent no slot", async () => {
    expect((await poke({ kind: "vibe", intensity: 20, repetitions: 1 }, pokeId)).status()).toBe(201);
  });

  await test.step("the next one inside the interval is a 429 that says how long", async () => {
    const again = await poke({ kind: "vibe", intensity: 20, repetitions: 1 });
    expect(again.status()).toBe(429);
    expect((await again.json()).message).toMatch(/once every 60s\. Try again in \d+s\./);
  });

  await test.step("but a retry of the poke that landed is still answered", async () => {
    const retry = await poke({ kind: "vibe", intensity: 20, repetitions: 1 }, pokeId);
    expect(retry.status()).toBe(200);
    expect((await retry.json()).id).toBe(pokeId);
  });

  await test.step("a burst lands exactly once", async () => {
    const burst = await mint(request, alice, {
      name: "burst",
      scopes: ["pokes:send"],
      minIntervalSeconds: 60,
    });
    const statuses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request
          .post(`${API}/pokes`, {
            headers: auth(burst.token),
            data: { friendId: bob.user.id, stimulus: { kind: "vibe", intensity: 10, repetitions: 1 } },
          })
          .then((r) => r.status()),
      ),
    );
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  await test.step("the listing says what the token was limited to", async () => {
    const tokens = await (await request.get(`${API}/me/tokens`, { headers: auth(alice.token) })).json();
    expect(tokens.find((t: { id: string }) => t.id === limited.id)).toMatchObject({
      allowedKinds: ["vibe"],
      maxIntensity: 30,
      minIntervalSeconds: 60,
    });
  });
});
