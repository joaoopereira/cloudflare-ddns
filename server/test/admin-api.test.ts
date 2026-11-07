import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
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
