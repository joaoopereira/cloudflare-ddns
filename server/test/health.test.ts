import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { setupDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await setupDb());
});

afterAll(async () => {
  await dispose?.();
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
