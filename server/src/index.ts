import { Hono } from "hono";
import type { Env } from "./env";

export const app = new Hono<{ Bindings: Env }>();

app.get("/health", async (c) => {
  // A trivial query proves the D1 binding and schema are in place.
  const row = await c.env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'registration_open'",
  ).first<{ value: string }>();
  return c.json({ ok: true, db: row !== null });
});

// Client API (epic #2) and admin API (#13) are added in follow-up PRs.

export default app;
