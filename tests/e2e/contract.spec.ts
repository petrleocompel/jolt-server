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
    expect((await second.json()).status).toBe("fired");
  });

  await test.step("both sides see the event, with opposite directions", async () => {
    const [sent, received] = await Promise.all([
      request.get(`${API}/pokes`, { headers: auth(alice.token) }),
      request.get(`${API}/pokes`, { headers: auth(bob.token) }),
    ]);
    expect((await sent.json())[0]).toMatchObject({ direction: "sent", status: "fired" });
    expect((await received.json())[0]).toMatchObject({ direction: "received", status: "fired" });
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

  await test.step("minting one returns the secret exactly once", async () => {
    const response = await request.post(`${API}/me/tokens`, {
      headers: auth(erin.token),
      data: { name: "home assistant" },
    });
    expect(response.status()).toBe(201);
    const created = await response.json();
    expect(created.token).toMatch(/^jolt_pat_/);
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
    expect((await request.get(`${API}/friends`, { headers: auth(token) })).status()).toBe(403);
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

  await test.step("with a device it lands in the activity feed, acked as usual", async () => {
    const registered = await request.post(`${API}/devices/push-token`, {
      headers: auth(erin.token),
      data: { token: `e2e-${unique()}${unique()}`, platform: "ios" },
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
