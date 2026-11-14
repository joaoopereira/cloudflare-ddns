import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { vi } from "vitest";
import { app } from "../src/index";
import type { Env } from "../src/env";

const migrationsDir = join(__dirname, "..", "migrations");

/** Start an in-memory D1 with all migrations applied. */
export async function setupDb() {
  const proxy = await getPlatformProxy<{ DB: D1Database; RELEASES: R2Bucket }>({ persist: false });
  const db = proxy.env.DB;
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    // D1 exec() runs one statement per line, so split on statement boundaries.
    const statements = sql
      .replace(/--.*$/gm, "")
      .split(/;\s*(?:\n|$)/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    for (const statement of statements) await db.exec(statement);
  }
  return { db, bucket: proxy.env.RELEASES, dispose: () => proxy.dispose() };
}

export async function resetDb(db: D1Database) {
  await db.batch([
    db.prepare("DELETE FROM clients"),
    db.prepare("DELETE FROM blocked_ips"),
    db.prepare("DELETE FROM events"),
    db.prepare("UPDATE settings SET value = 'false' WHERE key = 'registration_open'"),
    db.prepare("UPDATE settings SET value = '300' WHERE key = 'approval_timeout_seconds'"),
    db.prepare("UPDATE settings SET value = '' WHERE key = 'target_client_version'"),
  ]);
}

export function makeEnv(db: D1Database, extra: Partial<Env> = {}): Env {
  return { DB: db, CF_API_TOKEN: "test-token", ALLOW_INSECURE_ADMIN: "true", ...extra };
}

export function call(env: Env, method: string, path: string, body?: unknown, ip = "203.0.113.10") {
  return app.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}

export const clientCreds = (n = 1) => ({
  id: `client-${String(n).padStart(4, "0")}`,
  secret: `s${String(n).repeat(40)}`.slice(0, 40),
  hostname: `host-${n}`,
  os: "linux",
  arch: "amd64",
  version: "v0.1.0",
});

interface FakeRecord {
  id: string;
  name: string;
  content: string;
}

/**
 * Replace global fetch with a tiny fake of the Cloudflare API: one zone
 * (example.com) and an in-memory list of A records.
 */
export function mockCloudflare() {
  const zone = { id: "zone-1", name: "example.com" };
  const records: FakeRecord[] = [];
  const calls: string[] = [];
  let nextId = 1;
  const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200 });
  const notFound = () =>
    new Response(JSON.stringify({ success: false, errors: [{ message: "not found" }] }), { status: 404 });

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/client/v4", "");
    calls.push(`${method} ${path}`);
    const body = init?.body ? JSON.parse(init.body as string) : undefined;

    if (method === "GET" && path === "/zones") return ok(url.searchParams.get("page") === "1" ? [zone] : []);
    if (method === "GET" && path === `/zones/${zone.id}`) return ok(zone);
    if (path.startsWith("/zones/") && !path.startsWith(`/zones/${zone.id}`)) return notFound();
    if (method === "GET" && path === `/zones/${zone.id}/dns_records`) {
      return ok(records.filter((r) => r.name === url.searchParams.get("name")));
    }
    if (method === "POST" && path === `/zones/${zone.id}/dns_records`) {
      const rec = { id: `rec-${nextId++}`, name: body.name, content: body.content };
      records.push(rec);
      return ok(rec);
    }
    const m = path.match(/^\/zones\/zone-1\/dns_records\/(.+)$/);
    if (m) {
      const rec = records.find((r) => r.id === m[1]);
      if (!rec) return notFound();
      if (method === "PATCH") {
        rec.content = body.content;
        return ok(rec);
      }
      if (method === "DELETE") {
        records.splice(records.indexOf(rec), 1);
        return ok({ id: rec.id });
      }
    }
    return notFound();
  });
  vi.stubGlobal("fetch", fetchMock);
  return { zone, records, calls, fetchMock };
}
