import { Hono } from "hono";
import type { AppEnv } from "../env";
import { expirePendingClients, getClient, isBlocked, type ClientRow } from "../lib/clients";
import { CloudflareApi } from "../lib/cloudflare";
import { eventStmt, logEvent } from "../lib/events";
import { getSettings, type Settings } from "../lib/settings";
import { isIPv4, now, safeEqual, sha256Hex } from "../lib/util";

/**
 * Public API used by ddns-client. Clients authenticate with the id and
 * secret they generated on first run. Their public IP is taken from the
 * request (CF-Connecting-IP), never from the body.
 */
export const clientApi = new Hono<AppEnv>();

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_FIELD = 128;

interface Credentials {
  id: string;
  secret: string;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, MAX_FIELD) : null;
}

function parseCredentials(body: Record<string, unknown>): Credentials | null {
  const { id, secret } = body;
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 256) return null;
  return { id, secret };
}

async function authenticate(db: D1Database, creds: Credentials): Promise<ClientRow | "unknown" | "bad_secret"> {
  const client = await getClient(db, creds.id);
  if (!client) return "unknown";
  return safeEqual(client.secret_hash, await sha256Hex(creds.secret)) ? client : "bad_secret";
}

function targetVersion(client: ClientRow, settings: Settings, reportedVersion: string | null): string | undefined {
  const target = client.target_version || settings.target_client_version;
  return target && target !== reportedVersion ? target : undefined;
}

clientApi.use("*", async (c, next) => {
  const ip = c.req.header("CF-Connecting-IP");
  if (!ip || !isIPv4(ip)) {
    return c.json({ error: "an IPv4 connection is required" }, 400);
  }
  // Lazily enforce the approval timeout (the cron trigger also does this).
  await expirePendingClients(c.env.DB);
  return next();
});

clientApi.post("/register", async (c) => {
  const db = c.env.DB;
  const ip = c.req.header("CF-Connecting-IP")!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const creds = parseCredentials(body);
  if (!creds) return c.json({ error: "invalid id or secret" }, 400);

  if (await isBlocked(db, ip)) return c.json({ status: "blocked" }, 403);

  const settings = await getSettings(db);
  const existing = await authenticate(db, creds);
  if (existing === "bad_secret") return c.json({ error: "unauthorized" }, 401);

  if (existing !== "unknown") {
    // A rejected client whose IP was unblocked may register again.
    if (existing.status === "rejected") {
      if (!settings.registration_open) return c.json({ status: "closed" }, 403);
      await db.batch([
        db
          .prepare("UPDATE clients SET status = 'pending', registered_ip = ?, first_seen = ?, last_seen = ? WHERE id = ?")
          .bind(ip, now(), now(), existing.id),
        eventStmt(db, "registered", existing.id, { ip, again: true }),
      ]);
      return c.json({ status: "pending", interval: settings.heartbeat_interval_seconds }, 201);
    }
    return c.json({ status: existing.status, interval: settings.heartbeat_interval_seconds });
  }

  if (c.env.REGISTER_LIMITER) {
    const { success } = await c.env.REGISTER_LIMITER.limit({ key: ip });
    if (!success) return c.json({ status: "rate_limited" }, 429);
  }
  if (!settings.registration_open) return c.json({ status: "closed" }, 403);

  const ts = now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO clients (id, secret_hash, status, hostname, os, arch, version, registered_ip, first_seen, last_seen)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(creds.id, await sha256Hex(creds.secret), str(body.hostname), str(body.os), str(body.arch), str(body.version), ip, ts, ts),
    eventStmt(db, "registered", creds.id, { ip, hostname: str(body.hostname) }),
  ]);
  return c.json({ status: "pending", interval: settings.heartbeat_interval_seconds }, 201);
});

clientApi.post("/heartbeat", async (c) => {
  const db = c.env.DB;
  const ip = c.req.header("CF-Connecting-IP")!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const creds = parseCredentials(body);
  if (!creds) return c.json({ error: "invalid id or secret" }, 400);

  const client = await authenticate(db, creds);
  if (client === "unknown") return c.json({ status: "unknown" }, 404);
  if (client === "bad_secret") return c.json({ error: "unauthorized" }, 401);
  if (client.status === "rejected" || client.status === "revoked") {
    return c.json({ status: client.status }, 403);
  }

  const settings = await getSettings(db);
  const version = str(body.version);
  const clientError = str(body.error);
  const ts = now();

  if (version && client.version && version !== client.version) {
    await logEvent(db, "upgraded", client.id, { from: client.version, to: version });
  }
  await db
    .prepare("UPDATE clients SET last_seen = ?, version = COALESCE(?, version) WHERE id = ?")
    .bind(ts, version, client.id)
    .run();

  const response = {
    status: client.status,
    interval: settings.heartbeat_interval_seconds,
    target_version: targetVersion(client, settings, version),
    ip,
  };

  // Only approved clients with an assigned record ever touch DNS.
  if (client.status !== "approved" || !client.zone_id || !client.record_name) {
    if (clientError) await db.prepare("UPDATE clients SET last_error = ? WHERE id = ?").bind(clientError, client.id).run();
    return c.json(response);
  }

  if (client.current_ip === ip && client.record_id) {
    await db.prepare("UPDATE clients SET last_error = ? WHERE id = ?").bind(clientError, client.id).run();
    return c.json(response);
  }

  if (!c.env.CF_API_TOKEN) {
    await db.prepare("UPDATE clients SET last_error = ? WHERE id = ?").bind("server has no CF_API_TOKEN", client.id).run();
    return c.json({ ...response, dns: "error" });
  }

  try {
    const recordId = await new CloudflareApi(c.env.CF_API_TOKEN).upsertARecord(
      client.zone_id,
      client.record_name,
      ip,
      client.record_id,
    );
    await db.batch([
      db
        .prepare("UPDATE clients SET current_ip = ?, record_id = ?, last_ip_change = ?, last_error = ? WHERE id = ?")
        .bind(ip, recordId, ts, clientError, client.id),
      eventStmt(db, "ip_changed", client.id, { from: client.current_ip, to: ip, record: client.record_name }),
    ]);
    return c.json({ ...response, dns: "updated" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Log the failure once per distinct error to keep the audit log readable.
    const stmts = [db.prepare("UPDATE clients SET last_error = ? WHERE id = ?").bind(message, client.id)];
    if (client.last_error !== message) stmts.push(eventStmt(db, "dns_error", client.id, { error: message }));
    await db.batch(stmts);
    return c.json({ ...response, dns: "error" });
  }
});
