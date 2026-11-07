import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { expirePendingClients } from "./lib/clients";
import { adminApi } from "./routes/admin";
import { clientApi } from "./routes/client";
import { publicRoutes } from "./routes/public";

export const app = new Hono<AppEnv>();

app.get("/health", async (c) => {
  // A trivial query proves the D1 binding and schema are in place.
  const row = await c.env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'registration_open'",
  ).first<{ value: string }>();
  return c.json({ ok: true, db: row !== null });
});

app.route("/", publicRoutes);
app.route("/api/client", clientApi);
app.route("/api/admin", adminApi);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default {
  fetch: app.fetch,
  // Cron trigger: enforce the approval timeout even when no client is calling.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(expirePendingClients(env.DB));
  },
} satisfies ExportedHandler<Env>;
