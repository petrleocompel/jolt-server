import { createHash, createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import { base64url, fromBase64url } from "#/push/envelope";

/**
 * Who this server is to the push relay — section 3 of the relay protocol
 * (jolt-relay/spec/protocol-v1.md).
 *
 * A server is an Ed25519 key pair, and its `serverId` is derived from the
 * public half, so there is nothing to sign up for: the first request proves
 * possession of the key and the relay takes the id from it. Every request
 * after that carries a short-lived JWT signed by the same key.
 *
 * Nothing here touches the database or the environment. Where the key comes
 * from — `PUSH_RELAY_PRIVATE_KEY`, or the `relay_identity` server setting —
 * is decided in src/push/index.ts and passed in as a loader, so this module
 * stays testable against the shared vectors alone.
 */

export interface RelayIdentity {
  serverId: string;
  /** Raw 32-byte Ed25519 public key. */
  publicKey: Buffer;
  privateKey: KeyObject;
}

const SEED_BYTES = 32;

/** RFC 8410's PKCS#8 header for an Ed25519 private key; the seed follows. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32, lowercase and unpadded — the alphabet a `serverId` uses. */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** `srv_` + base32 of the first 16 bytes of SHA-256(raw public key). */
export function serverIdFor(publicKey: Uint8Array): string {
  return `srv_${base32(createHash("sha256").update(publicKey).digest().subarray(0, 16))}`;
}

export function generateIdentitySeed(): Buffer {
  return randomBytes(SEED_BYTES);
}

export function identityFromSeed(seed: Uint8Array): RelayIdentity {
  if (seed.length !== SEED_BYTES) throw new Error(`Ed25519 seed must be ${SEED_BYTES} bytes`);
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  return identityFromPrivateKey(privateKey);
}

function identityFromPrivateKey(privateKey: KeyObject): RelayIdentity {
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("the relay identity must be an Ed25519 key");
  }
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  const publicKey = fromBase64url(String(jwk.x));
  return { serverId: serverIdFor(publicKey), publicKey, privateKey };
}

/**
 * Reads `PUSH_RELAY_PRIVATE_KEY`: either a PKCS#8 PEM (what
 * `openssl genpkey -algorithm ed25519` prints) or the raw 32-byte seed in
 * base64 or base64url. Throws on anything else — a typo here would otherwise
 * quietly become a different server.
 */
export function parseIdentityKey(raw: string): RelayIdentity {
  const text = raw.replace(/\\n/g, "\n").trim();
  if (text.startsWith("-----BEGIN")) {
    return identityFromPrivateKey(createPrivateKey({ key: text, format: "pem" }));
  }
  const asBase64url = text.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  let seed: Buffer | null = null;
  try {
    seed = fromBase64url(asBase64url);
  } catch {
    seed = null;
  }
  if (seed?.length !== SEED_BYTES) {
    throw new Error("PUSH_RELAY_PRIVATE_KEY must be a PEM key or a base64 32-byte Ed25519 seed");
  }
  return identityFromSeed(seed);
}

/** The relay rejects anything valid for longer than this. */
export const RELAY_JWT_LIFETIME_SECONDS = 300;

/** `Authorization: Bearer` for one request to the relay. */
export async function signRelayJwt(
  identity: RelayIdentity,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: identity.serverId })
    .setIssuer(identity.serverId)
    .setAudience("jolt-relay")
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + RELAY_JWT_LIFETIME_SECONDS)
    .sign(identity.privateKey);
}

export type RelayRegistrationState = "unregistered" | "registered" | "blocked" | "failed";

/** What the admin overview shows about the relay. */
export interface RelayStatus {
  url: string;
  serverId: string | null;
  registration: RelayRegistrationState;
  registeredAt: string | null;
  limits: { perRegistrationPerDay: number; perServerPerDay: number } | null;
  lastError: { message: string; at: string } | null;
}

export interface RelayClientOptions {
  /** Base URL of the relay, e.g. `https://relay.example/`. */
  url: string;
  loadIdentity: () => Promise<RelayIdentity>;
  /** jolt-server version. Always sent. */
  version: string;
  /** Opt-in: sent only when the operator set `PUSH_RELAY_SERVER_NAME`. */
  name?: string;
  /** Opt-in: sent only when the operator set `PUSH_RELAY_PUBLIC_URL`. */
  publicUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class RelayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RelayError";
  }
}

/** A failed registration is not retried more often than this. */
const REGISTRATION_RETRY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Talks to the relay on this server's behalf: signs each request, and
 * registers the server the first time it is needed rather than at boot, so a
 * relay that is down when the server starts costs nothing until a push is
 * actually due.
 */
export class RelayClient {
  private identity: Promise<RelayIdentity> | null = null;
  private cachedJwt: { value: string; expiresAt: number } | null = null;
  private registering: Promise<void> | null = null;
  private failedAt = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly state: Omit<RelayStatus, "url" | "serverId"> = {
    registration: "unregistered",
    registeredAt: null,
    limits: null,
    lastError: null,
  };

  constructor(private readonly options: RelayClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  getIdentity(): Promise<RelayIdentity> {
    this.identity ??= this.options.loadIdentity().catch((error: unknown) => {
      // Not cached: a database blip at the first push must not leave the
      // server without an identity until it restarts.
      this.identity = null;
      throw error;
    });
    return this.identity;
  }

  /** `https://relay.example/` + `v1/send`, whether or not the base ends in a slash. */
  endpoint(path: string): string {
    return new URL(path, this.options.url.endsWith("/") ? this.options.url : `${this.options.url}/`)
      .toString();
  }

  private async authorization(): Promise<string> {
    const now = this.now();
    if (this.cachedJwt && this.cachedJwt.expiresAt > now) return `Bearer ${this.cachedJwt.value}`;
    const value = await signRelayJwt(await this.getIdentity(), Math.floor(now / 1000));
    // Renewed a minute early, so a token never reaches the relay with only
    // seconds of its five minutes left.
    this.cachedJwt = { value, expiresAt: now + (RELAY_JWT_LIFETIME_SECONDS - 60) * 1000 };
    return `Bearer ${value}`;
  }

  /** One signed JSON request. Network failures and timeouts reject. */
  async request(method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(this.endpoint(path), {
      method,
      headers: {
        authorization: await this.authorization(),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  /**
   * Registers the server unless that already happened in this process.
   * Concurrent callers share one attempt. `force` re-registers anyway — what
   * a 404 `unknown_server` from the relay asks for.
   */
  ensureRegistered(options: { force?: boolean } = {}): Promise<void> {
    if (!options.force) {
      if (this.state.registration === "registered") return Promise.resolve();
      if (this.registering) return this.registering;
      if (this.state.lastError && this.now() - this.failedAt < REGISTRATION_RETRY_MS) {
        const blocked = this.state.registration === "blocked";
        return Promise.reject(
          new RelayError(
            this.state.lastError.message,
            blocked ? 403 : undefined,
            blocked ? "server_blocked" : undefined,
          ),
        );
      }
    }
    const attempt = this.register().finally(() => {
      if (this.registering === attempt) this.registering = null;
    });
    this.registering = attempt;
    return attempt;
  }

  /** Called when the relay no longer knows this server. */
  forgetRegistration(): void {
    if (this.state.registration === "registered") this.state.registration = "unregistered";
  }

  private async register(): Promise<void> {
    try {
      const identity = await this.getIdentity();
      const body: Record<string, string> = {
        publicKey: base64url(identity.publicKey),
        version: this.options.version,
      };
      if (this.options.name) body.name = this.options.name;
      if (this.options.publicUrl) body.publicUrl = this.options.publicUrl;

      const response = await this.request("POST", "v1/servers", body);
      const payload = (await response.json().catch(() => null)) as {
        serverId?: string;
        error?: string;
        limits?: RelayStatus["limits"];
      } | null;

      if (response.status === 403 && payload?.error === "server_blocked") {
        this.state.registration = "blocked";
        throw new RelayError("The relay has blocked this server.", 403, "server_blocked");
      }
      if (response.status !== 200 && response.status !== 201) {
        throw new RelayError(
          `Relay registration failed: HTTP ${response.status}${payload?.error ? ` ${payload.error}` : ""}`,
          response.status,
          payload?.error,
        );
      }
      if (payload?.serverId && payload.serverId !== identity.serverId) {
        // Both sides derive the id from the same key, so a mismatch means
        // one of the two implementations is wrong — not something to paper over.
        throw new RelayError(
          `The relay derived ${payload.serverId} for this server's key, expected ${identity.serverId}.`,
        );
      }

      this.state.registration = "registered";
      this.state.registeredAt = new Date(this.now()).toISOString();
      this.state.limits = payload?.limits ?? null;
      console.log(`[push] registered with the relay as ${identity.serverId}`);
    } catch (error) {
      if (this.state.registration !== "blocked") this.state.registration = "failed";
      this.failedAt = this.now();
      this.recordError(error);
      throw error;
    }
  }

  /** Remembers a failure for the admin overview. */
  recordError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.state.lastError = { message, at: new Date(this.now()).toISOString() };
  }

  /** Marks the server blocked after a 403 on any endpoint. */
  markBlocked(): void {
    this.state.registration = "blocked";
  }

  async status(): Promise<RelayStatus> {
    const serverId = await this.getIdentity().then(
      (identity) => identity.serverId,
      () => null,
    );
    return { url: this.options.url, serverId, ...this.state };
  }
}
