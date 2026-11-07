import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";

const migrationsDir = join(__dirname, "..", "migrations");

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;

beforeAll(async () => {
  // In-memory local D1 from wrangler.toml (persist: false keeps tests isolated).
  proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: false });
  db = proxy.env.DB;
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
});

afterAll(async () => {
  await proxy?.dispose();
});

describe("GET /health", () => {
  it("reports the database as ready once migrations are applied", async () => {
    const res = await app.request("/health", {}, { DB: db, PUBLIC_URL: "http://localhost" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: true });
  });

  it("seeds default settings", async () => {
    const timeout = await db
      .prepare("SELECT value FROM settings WHERE key = 'approval_timeout_seconds'")
      .first<{ value: string }>();
    expect(timeout?.value).toBe("300");
  });
});
