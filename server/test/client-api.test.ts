import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { expirePendingClients } from "../src/lib/clients";
import type { Env } from "../src/env";
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const openRegistration = () => call(env, "PUT", "/api/admin/settings", { registration_open: true });

async function registerAndApprove(n = 1, ip = "203.0.113.10") {
  await openRegistration();
  const creds = clientCreds(n);
  expect((await call(env, "POST", "/api/client/register", creds, ip)).status).toBe(201);
  const res = await call(env, "POST", `/api/admin/clients/${creds.id}/approve`, { zone_id: "zone-1", record_name: `home${n}` });
  expect(res.status).toBe(200);
  return creds;
}

describe("POST /api/client/register", () => {
  it("rejects registration while listening is off", async () => {
    const res = await call(env, "POST", "/api/client/register", clientCreds());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: "closed" });
  });

  it("creates a pending client with the caller's IP when listening is on", async () => {
    await openRegistration();
    const res = await call(env, "POST", "/api/client/register", clientCreds(), "198.51.100.7");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "pending", interval: 60 });
    const row = await db.prepare("SELECT status, registered_ip, hostname, secret_hash FROM clients").first<Record<string, string>>();
    expect(row).toMatchObject({ status: "pending", registered_ip: "198.51.100.7", hostname: "host-1" });
    expect(row?.secret_hash).not.toContain("s1111");
  });

  it("is idempotent for the same credentials and rejects a wrong secret", async () => {
    await openRegistration();
    const creds = clientCreds();
    await call(env, "POST", "/api/client/register", creds);
    const again = await call(env, "POST", "/api/client/register", creds);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: "pending" });
    const wrong = await call(env, "POST", "/api/client/register", { ...creds, secret: "x".repeat(40) });
    expect(wrong.status).toBe(401);
  });

  it("validates input and requires an IPv4 caller", async () => {
    await openRegistration();
    expect((await call(env, "POST", "/api/client/register", { id: "short", secret: "x" })).status).toBe(400);
    expect((await call(env, "POST", "/api/client/register", clientCreds(), "2001:db8::1")).status).toBe(400);
  });

  it("refuses blocked IPs", async () => {
    await openRegistration();
    await db.prepare("INSERT INTO blocked_ips (ip, reason, blocked_at) VALUES ('203.0.113.10', 'test', 0)").run();
    const res = await call(env, "POST", "/api/client/register", clientCreds());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: "blocked" });
  });

  it("applies the per-IP rate limit to new registrations", async () => {
    await openRegistration();
    env.REGISTER_LIMITER = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const res = await call(env, "POST", "/api/client/register", clientCreds());
    expect(res.status).toBe(429);
  });
});

describe("approval timeout", () => {
  it("rejects pending clients after the timeout and blocks their IP", async () => {
    await openRegistration();
    await call(env, "PUT", "/api/admin/settings", { approval_timeout_seconds: 60 });
    const creds = clientCreds();
    await call(env, "POST", "/api/client/register", creds, "198.51.100.7");

    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    expect(await expirePendingClients(db)).toBe(1);
    const client = await db.prepare("SELECT status FROM clients WHERE id = ?").bind(creds.id).first<{ status: string }>();
    expect(client?.status).toBe("rejected");
    const blocked = await call(env, "GET", "/api/admin/blocked-ips");
    expect(await blocked.json()).toMatchObject({ blocked_ips: [{ ip: "198.51.100.7", reason: "approval timeout" }] });

    // Blocked: the same machine can't register again...
    expect((await call(env, "POST", "/api/client/register", creds, "198.51.100.7")).status).toBe(403);
    // ...until the user unblocks the IP, then it shows up as pending again.
    expect((await call(env, "DELETE", "/api/admin/blocked-ips/198.51.100.7")).status).toBe(200);
    const again = await call(env, "POST", "/api/client/register", creds, "198.51.100.7");
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ status: "pending" });
  });

  it("is enforced lazily on client requests", async () => {
    await openRegistration();
    await call(env, "PUT", "/api/admin/settings", { approval_timeout_seconds: 30 });
    const creds = clientCreds();
    await call(env, "POST", "/api/client/register", creds);
    vi.useFakeTimers({ now: Date.now() + 31_000, toFake: ["Date"] });
    const res = await call(env, "POST", "/api/client/heartbeat", creds);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: "rejected" });
  });
});

describe("POST /api/client/heartbeat", () => {
  it("never touches DNS for a pending client", async () => {
    const cf = mockCloudflare();
    await openRegistration();
    const creds = clientCreds();
    await call(env, "POST", "/api/client/register", creds);
    const res = await call(env, "POST", "/api/client/heartbeat", creds);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "pending" });
    expect(cf.calls).toEqual([]);
  });

  it("creates the record on first heartbeat and updates it when the IP changes", async () => {
    const cf = mockCloudflare();
    const creds = await registerAndApprove(1);

    const first = await call(env, "POST", "/api/client/heartbeat", creds, "203.0.113.10");
    expect(await first.json()).toMatchObject({ status: "approved", dns: "updated" });
    expect(cf.records).toEqual([{ id: "rec-1", name: "home1.example.com", content: "203.0.113.10" }]);

    cf.calls.length = 0;
    const same = await call(env, "POST", "/api/client/heartbeat", creds, "203.0.113.10");
    expect(await same.json()).not.toHaveProperty("dns");
    expect(cf.calls).toEqual([]);

    const moved = await call(env, "POST", "/api/client/heartbeat", creds, "198.51.100.99");
    expect(await moved.json()).toMatchObject({ dns: "updated" });
    expect(cf.records[0].content).toBe("198.51.100.99");
    const row = await db.prepare("SELECT current_ip, record_id FROM clients").first();
    expect(row).toEqual({ current_ip: "198.51.100.99", record_id: "rec-1" });
  });

  it("adopts an existing record and recreates one deleted outside the app", async () => {
    const cf = mockCloudflare();
    cf.records.push({ id: "pre-existing", name: "home1.example.com", content: "192.0.2.1" });
    const creds = await registerAndApprove(1);
    await call(env, "POST", "/api/client/heartbeat", creds, "203.0.113.10");
    expect(cf.records).toEqual([{ id: "pre-existing", name: "home1.example.com", content: "203.0.113.10" }]);

    cf.records.length = 0;
    await call(env, "POST", "/api/client/heartbeat", creds, "203.0.113.11");
    expect(cf.records).toMatchObject([{ name: "home1.example.com", content: "203.0.113.11" }]);
  });

  it("records DNS errors without failing the heartbeat", async () => {
    const cf = mockCloudflare();
    const creds = await registerAndApprove(1);
    cf.fetchMock.mockImplementation(async () => new Response("boom", { status: 500 }));
    const res = await call(env, "POST", "/api/client/heartbeat", creds);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dns: "error" });
    const row = await db.prepare("SELECT last_error FROM clients").first<{ last_error: string }>();
    expect(row?.last_error).toContain("HTTP 500");
  });

  it("returns the target version until the client reports it", async () => {
    mockCloudflare();
    const creds = await registerAndApprove(1);
    await call(env, "PUT", "/api/admin/settings", { target_client_version: "v0.2.0" });
    const res = await call(env, "POST", "/api/client/heartbeat", creds);
    expect(await res.json()).toMatchObject({ target_version: "v0.2.0" });

    // A per-client override wins over the global target.
    await call(env, "POST", `/api/admin/clients/${creds.id}/upgrade`, { version: "v0.3.0" });
    const res2 = await call(env, "POST", "/api/client/heartbeat", creds);
    expect(await res2.json()).toMatchObject({ target_version: "v0.3.0" });

    const done = await call(env, "POST", "/api/client/heartbeat", { ...creds, version: "v0.3.0" });
    expect(await done.json()).not.toHaveProperty("target_version");
    const ev = await db.prepare("SELECT type FROM events WHERE type = 'upgraded'").first();
    expect(ev).toEqual({ type: "upgraded" });
  });

  it("refuses revoked and unknown clients", async () => {
    mockCloudflare();
    const creds = await registerAndApprove(1);
    await call(env, "POST", `/api/admin/clients/${creds.id}/revoke`);
    expect((await call(env, "POST", "/api/client/heartbeat", creds)).status).toBe(403);
    expect((await call(env, "POST", "/api/client/heartbeat", clientCreds(9))).status).toBe(404);
  });
});
