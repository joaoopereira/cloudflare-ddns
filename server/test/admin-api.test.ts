import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { toFqdn } from "../src/routes/admin";
import { call, clientCreds, makeEnv, mockCloudflare, resetDb, setupDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;
let env: Env;

beforeAll(async () => {
  ({ db, dispose } = await setupDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  await resetDb(db);
  env = makeEnv(db);
});
afterEach(() => vi.unstubAllGlobals());

describe("admin auth", () => {
  it("returns 503 when Access is not configured", async () => {
    const res = await call(makeEnv(db, { ALLOW_INSECURE_ADMIN: undefined }), "GET", "/api/admin/clients");
    expect(res.status).toBe(503);
  });

  it("returns 401 without a valid Access token", async () => {
    mockCloudflare(); // makes the certs fetch return 404
    const res = await call(
      makeEnv(db, { ALLOW_INSECURE_ADMIN: undefined, ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud" }),
      "GET",
      "/api/admin/clients",
    );
    expect(res.status).toBe(401);
  });
});

describe("Access JWT", () => {
  const team = "jwt-test.cloudflareaccess.com";
  const aud = "test-aud";
  const accessEnv = () => makeEnv(db, { ALLOW_INSECURE_ADMIN: undefined, ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud });
  const rsa = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  let key: CryptoKeyPair;
  let otherKey: CryptoKeyPair;

  beforeAll(async () => {
    key = (await crypto.subtle.generateKey(rsa, true, ["sign", "verify"])) as CryptoKeyPair;
    otherKey = (await crypto.subtle.generateKey(rsa, true, ["sign", "verify"])) as CryptoKeyPair;
  });
  beforeEach(async () => {
    const jwk = { ...(await crypto.subtle.exportKey("jwk", key.publicKey)), kid: "kid-1" };
    vi.stubGlobal("fetch", async (url: string) =>
      url === `https://${team}/cdn-cgi/access/certs`
        ? new Response(JSON.stringify({ keys: [jwk] }))
        : new Response("not found", { status: 404 }),
    );
  });

  const b64url = (data: string | ArrayBuffer) =>
    btoa(typeof data === "string" ? data : String.fromCharCode(...new Uint8Array(data)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  async function sign(
    claims: Record<string, unknown> = {},
    header: Record<string, unknown> = {},
    signer = key.privateKey,
  ) {
    const nowSec = Math.floor(Date.now() / 1000);
    const h = b64url(JSON.stringify({ alg: "RS256", kid: "kid-1", ...header }));
    const p = b64url(
      JSON.stringify({ aud: [aud], iss: `https://${team}`, email: "admin@example.com", iat: nowSec, nbf: nowSec, exp: nowSec + 300, ...claims }),
    );
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64url(sig)}`;
  }

  const me = (token: string) =>
    app.request("/api/admin/me", { headers: { "Cf-Access-Jwt-Assertion": token } }, accessEnv());

  it("accepts a valid token and takes the admin email from it", async () => {
    const res = await me(await sign());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "admin@example.com" });
  });

  it("rejects a token signed with a different key", async () => {
    expect((await me(await sign({}, {}, otherKey.privateKey))).status).toBe(401);
  });

  const nowSec = () => Math.floor(Date.now() / 1000);
  it.each([
    ["a wrong aud", () => ({ aud: ["other-aud"] }), {}],
    ["a wrong iss", () => ({ iss: "https://evil.cloudflareaccess.com" }), {}],
    ["an expired exp", () => ({ exp: nowSec() - 60 }), {}],
    ["a future nbf", () => ({ nbf: nowSec() + 3600 }), {}],
    ["a non-RS256 alg", () => ({}), { alg: "HS256" }],
    ["an unknown kid", () => ({}), { kid: "kid-unknown" }],
  ])("rejects %s", async (_name, claims, header) => {
    expect((await me(await sign(claims(), header))).status).toBe(401);
  });
});

describe("toFqdn", () => {
  it.each([
    ["home", "home.example.com"],
    ["Home.Example.com", "home.example.com"],
    ["a.b", "a.b.example.com"],
    ["@", "example.com"],
    ["bad_name", null],
    ["-x", null],
  ])("%s -> %s", (input, expected) => {
    expect(toFqdn(input, "example.com")).toBe(expected);
  });
});

describe("clients", () => {
  async function pending(n = 1) {
    await call(env, "PUT", "/api/admin/settings", { registration_open: true });
    const creds = clientCreds(n);
    await call(env, "POST", "/api/client/register", creds, `203.0.113.${n}`);
    return creds;
  }

  it("lists clients with online state and approval deadline, without secrets", async () => {
    await pending();
    const res = await call(env, "GET", "/api/admin/clients");
    const { clients } = (await res.json()) as { clients: Record<string, unknown>[] };
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ status: "pending", online: true, registered_ip: "203.0.113.1" });
    expect(clients[0].approval_deadline).toBeTypeOf("number");
    expect(clients[0]).not.toHaveProperty("secret_hash");
  });

  it("approves with a zone and record, and refuses duplicate records", async () => {
    mockCloudflare();
    const a = await pending(1);
    const b = await pending(2);
    const ok = await call(env, "POST", `/api/admin/clients/${a.id}/approve`, { zone_id: "zone-1", record_name: "home" });
    expect(await ok.json()).toMatchObject({ client: { status: "approved", record_name: "home.example.com", zone_name: "example.com" } });
    const dup = await call(env, "POST", `/api/admin/clients/${b.id}/approve`, { zone_id: "zone-1", record_name: "home" });
    expect(dup.status).toBe(409);
    const badZone = await call(env, "POST", `/api/admin/clients/${b.id}/approve`, { zone_id: "nope", record_name: "x" });
    expect(badZone.status).toBe(400);
  });

  it("rejecting a pending client blocks its IP", async () => {
    const a = await pending(1);
    expect((await call(env, "POST", `/api/admin/clients/${a.id}/reject`)).status).toBe(200);
    const { blocked_ips } = (await (await call(env, "GET", "/api/admin/blocked-ips")).json()) as { blocked_ips: { ip: string }[] };
    expect(blocked_ips.map((b) => b.ip)).toEqual(["203.0.113.1"]);
  });

  it("deletes a client and optionally its DNS record", async () => {
    const cf = mockCloudflare();
    const a = await pending(1);
    await call(env, "POST", `/api/admin/clients/${a.id}/approve`, { zone_id: "zone-1", record_name: "home" });
    await call(env, "POST", "/api/client/heartbeat", a, "203.0.113.1");
    expect(cf.records).toHaveLength(1);
    expect((await call(env, "DELETE", `/api/admin/clients/${a.id}?delete_record=true`)).status).toBe(200);
    expect(cf.records).toHaveLength(0);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM clients").first()).toEqual({ n: 0 });
  });
});

describe("settings", () => {
  it("validates and saves settings", async () => {
    expect((await call(env, "PUT", "/api/admin/settings", { approval_timeout_seconds: 5 })).status).toBe(400);
    expect((await call(env, "PUT", "/api/admin/settings", { target_client_version: "latest" })).status).toBe(400);
    const res = await call(env, "PUT", "/api/admin/settings", { approval_timeout_seconds: 600, registration_open: true });
    expect(await res.json()).toMatchObject({ settings: { approval_timeout_seconds: 600, registration_open: true } });
  });

  it("logs events", async () => {
    await call(env, "PUT", "/api/admin/settings", { registration_open: true });
    const { events } = (await (await call(env, "GET", "/api/admin/events")).json()) as { events: { type: string }[] };
    expect(events.map((e) => e.type)).toContain("settings_changed");
  });
});

describe("friendly names", () => {
  async function pending(n = 1) {
    await call(env, "PUT", "/api/admin/settings", { registration_open: true });
    const creds = clientCreds(n);
    await call(env, "POST", "/api/client/register", creds, `203.0.113.${n}`);
    return creds;
  }
  const getName = async (id: string) =>
    ((await (await call(env, "GET", `/api/admin/clients/${id}`)).json()) as { client: { name: string | null } }).client.name;

  it("starts without a name", async () => {
    const a = await pending();
    expect(await getName(a.id)).toBeNull();
  });

  it("sets a trimmed name at approval and keeps it when the record changes", async () => {
    mockCloudflare();
    const a = await pending();
    const res = await call(env, "POST", `/api/admin/clients/${a.id}/approve`, {
      zone_id: "zone-1",
      record_name: "home",
      name: "  Home   NAS ",
    });
    expect(await res.json()).toMatchObject({ client: { name: "Home NAS" } });
    await call(env, "POST", `/api/admin/clients/${a.id}/approve`, { zone_id: "zone-1", record_name: "nas" });
    expect(await getName(a.id)).toBe("Home NAS");
  });

  it("renames and clears with PATCH, and logs a renamed event", async () => {
    const a = await pending();
    const set = await call(env, "PATCH", `/api/admin/clients/${a.id}`, { name: "Office router" });
    expect(set.status).toBe(200);
    expect(await getName(a.id)).toBe("Office router");
    await call(env, "PATCH", `/api/admin/clients/${a.id}`, { name: "   " });
    expect(await getName(a.id)).toBeNull();
    await call(env, "PATCH", `/api/admin/clients/${a.id}`, { name: "Again" });
    await call(env, "PATCH", `/api/admin/clients/${a.id}`, { name: null });
    expect(await getName(a.id)).toBeNull();
    const { events } = (await (await call(env, "GET", `/api/admin/events?client_id=${a.id}`)).json()) as {
      events: { type: string; detail: Record<string, unknown> }[];
    };
    const renames = events.filter((e) => e.type === "renamed");
    expect(renames).toHaveLength(4);
    expect(renames.at(-1)?.detail).toMatchObject({ from: null, to: "Office router" });
  });

  it("validates names", async () => {
    mockCloudflare();
    const a = await pending();
    for (const name of ["x".repeat(65), 42, "bad\u0007name"]) {
      expect((await call(env, "PATCH", `/api/admin/clients/${a.id}`, { name })).status).toBe(400);
    }
    expect((await call(env, "PATCH", `/api/admin/clients/${a.id}`, {})).status).toBe(400);
    expect((await call(env, "PATCH", `/api/admin/clients/${a.id}`, { name: "x".repeat(64) })).status).toBe(200);
    const approve = await call(env, "POST", `/api/admin/clients/${a.id}/approve`, {
      zone_id: "zone-1",
      record_name: "home",
      name: "y".repeat(65),
    });
    expect(approve.status).toBe(400);
    expect((await call(env, "PATCH", "/api/admin/clients/nope", { name: "x" })).status).toBe(404);
  });

  it("never lets a client set its own name", async () => {
    await call(env, "PUT", "/api/admin/settings", { registration_open: true });
    const creds = { ...clientCreds(1), name: "Sneaky" };
    await call(env, "POST", "/api/client/register", creds, "203.0.113.1");
    expect(await getName(creds.id)).toBeNull();
  });
});
