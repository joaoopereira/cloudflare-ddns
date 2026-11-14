import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireAccess } from "../lib/access";
import { getClient, rejectAndBlock, type ClientRow } from "../lib/clients";
import { CloudflareApi } from "../lib/cloudflare";
import { eventStmt, logEvent } from "../lib/events";
import { getSettings, updateSettings, type Settings } from "../lib/settings";
import { now } from "../lib/util";
import { latestVersion } from "./public";

/** Dashboard API. Protected by Cloudflare Access. */
export const adminApi = new Hono<AppEnv>();

adminApi.use("*", requireAccess);

const VERSION_RE = /^v?\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/;
const LABEL_RE = /^(\*|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)$/;
export const NAME_MAX = 64;

/**
 * Validate a friendly name from a request body. Returns the trimmed name,
 * null to clear it (null or blank), or an error message.
 */
export function parseName(value: unknown): { name: string | null } | { error: string } {
  if (value === null) return { name: null };
  if (typeof value !== "string") return { error: "name must be a string or null" };
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return { name: null };
  if (name.length > NAME_MAX) return { error: `name must be at most ${NAME_MAX} characters` };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { error: "name must not contain control characters" };
  return { name };
}

function cf(env: AppEnv["Bindings"]): CloudflareApi | null {
  return env.CF_API_TOKEN ? new CloudflareApi(env.CF_API_TOKEN) : null;
}

/** Public view of a client (never exposes the secret hash). */
function present(client: ClientRow, settings: Settings) {
  const { secret_hash: _secret, ...rest } = client;
  const onlineWindow = settings.heartbeat_interval_seconds * 3;
  return {
    ...rest,
    online: client.last_seen !== null && now() - client.last_seen <= onlineWindow,
    approval_deadline: client.status === "pending" ? client.first_seen + settings.approval_timeout_seconds : null,
    effective_target_version: client.target_version || settings.target_client_version || null,
  };
}

/** Build the FQDN from a record name ("home", "home.example.com" or "@") and zone name. */
export function toFqdn(recordName: string, zoneName: string): string | null {
  const name = recordName.trim().toLowerCase().replace(/\.$/, "");
  const zone = zoneName.toLowerCase();
  if (name === "@" || name === zone) return zone;
  const sub = name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name;
  if (!sub.split(".").every((label) => LABEL_RE.test(label))) return null;
  return `${sub}.${zone}`;
}

adminApi.get("/me", (c) => c.json({ email: c.get("adminEmail") ?? null }));

adminApi.get("/clients", async (c) => {
  const settings = await getSettings(c.env.DB);
  const { results } = await c.env.DB.prepare("SELECT * FROM clients ORDER BY status, record_name, first_seen").all<ClientRow>();
  return c.json({ clients: results.map((r) => present(r, settings)) });
});

adminApi.get("/clients/:id", async (c) => {
  const client = await getClient(c.env.DB, c.req.param("id"));
  if (!client) return c.json({ error: "not found" }, 404);
  return c.json({ client: present(client, await getSettings(c.env.DB)) });
});

adminApi.get("/zones", async (c) => {
  const api = cf(c.env);
  if (!api) return c.json({ error: "CF_API_TOKEN is not configured" }, 503);
  return c.json({ zones: await api.listZones() });
});

/** Approve a pending client, or change the record of an approved one. */
adminApi.post("/clients/:id/approve", async (c) => {
  const db = c.env.DB;
  const client = await getClient(db, c.req.param("id"));
  if (!client) return c.json({ error: "not found" }, 404);
  if (client.status !== "pending" && client.status !== "approved") {
    return c.json({ error: `cannot approve a ${client.status} client` }, 409);
  }
  const body = await c.req
    .json<{ zone_id?: string; record_name?: string; name?: unknown }>()
    .catch(() => ({}) as Record<string, never>);
  if (!body.zone_id || !body.record_name) return c.json({ error: "zone_id and record_name are required" }, 400);
  // `name` is optional: leave it out to keep the current name.
  const parsed = body.name === undefined ? null : parseName(body.name);
  if (parsed && "error" in parsed) return c.json({ error: parsed.error }, 400);
  const name = parsed ? parsed.name : client.name;

  const api = cf(c.env);
  if (!api) return c.json({ error: "CF_API_TOKEN is not configured" }, 503);
  const zone = await api.getZone(body.zone_id).catch(() => null);
  if (!zone) return c.json({ error: "zone not found" }, 400);
  const fqdn = toFqdn(body.record_name, zone.name);
  if (!fqdn) return c.json({ error: "invalid record name" }, 400);

  const taken = await db
    .prepare("SELECT id FROM clients WHERE record_name = ? AND id != ?")
    .bind(fqdn, client.id)
    .first<{ id: string }>();
  if (taken) return c.json({ error: `${fqdn} is already used by another client` }, 409);

  const changed = client.record_name !== fqdn;
  await db.batch([
    db
      .prepare(
        `UPDATE clients SET status = 'approved', name = ?, zone_id = ?, zone_name = ?, record_name = ?,
           record_id = CASE WHEN ? THEN NULL ELSE record_id END,
           current_ip = CASE WHEN ? THEN NULL ELSE current_ip END,
           approved_at = COALESCE(approved_at, ?), last_error = NULL
         WHERE id = ?`,
      )
      .bind(name, zone.id, zone.name, fqdn, changed ? 1 : 0, changed ? 1 : 0, now(), client.id),
    eventStmt(db, "approved", client.id, { record: fqdn, ...(name ? { name } : {}), by: c.get("adminEmail") }),
  ]);
  return c.json({ client: present((await getClient(db, client.id))!, await getSettings(db)) });
});

/** Edit a client's dashboard-only fields. Today that is the friendly name. */
adminApi.patch("/clients/:id", async (c) => {
  const db = c.env.DB;
  const client = await getClient(db, c.req.param("id"));
  if (!client) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ name?: unknown }>().catch(() => ({}) as Record<string, never>);
  if (body.name === undefined) return c.json({ error: "name is required (use null to clear it)" }, 400);
  const parsed = parseName(body.name);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  if (parsed.name !== client.name) {
    await db.batch([
      db.prepare("UPDATE clients SET name = ? WHERE id = ?").bind(parsed.name, client.id),
      eventStmt(db, "renamed", client.id, { from: client.name, to: parsed.name, by: c.get("adminEmail") }),
    ]);
  }
  return c.json({ client: present((await getClient(db, client.id))!, await getSettings(db)) });
});

adminApi.post("/clients/:id/reject", async (c) => {
  const client = await getClient(c.env.DB, c.req.param("id"));
  if (!client) return c.json({ error: "not found" }, 404);
  if (client.status !== "pending") return c.json({ error: "only pending clients can be rejected" }, 409);
  await rejectAndBlock(c.env.DB, client, `rejected by ${c.get("adminEmail") ?? "admin"}`);
  return c.json({ ok: true });
});

adminApi.post("/clients/:id/revoke", async (c) => {
  const db = c.env.DB;
  const client = await getClient(db, c.req.param("id"));
  if (!client) return c.json({ error: "not found" }, 404);
  await db.batch([
    db.prepare("UPDATE clients SET status = 'revoked' WHERE id = ?").bind(client.id),
    eventStmt(db, "revoked", client.id, { by: c.get("adminEmail") }),
  ]);
  return c.json({ ok: true });
});

adminApi.delete("/clients/:id", async (c) => {
  const db = c.env.DB;
  const client = await getClient(db, c.req.param("id"));
  if (!client) return c.json({ error: "not found" }, 404);
  if (c.req.query("delete_record") === "true" && client.zone_id && client.record_id) {
    const api = cf(c.env);
    if (!api) return c.json({ error: "CF_API_TOKEN is not configured" }, 503);
    await api.deleteRecord(client.zone_id, client.record_id);
  }
  await db.batch([
    db.prepare("DELETE FROM clients WHERE id = ?").bind(client.id),
    eventStmt(db, "deleted", client.id, { record: client.record_name, name: client.name, by: c.get("adminEmail") }),
  ]);
  return c.json({ ok: true });
});

/** Ask one client to upgrade (version), or clear its override (null). */
adminApi.post("/clients/:id/upgrade", async (c) => {
  const db = c.env.DB;
  const client = await getClient(db, c.req.param("id"));
  if (!client) return c.json({ error: "not found" }, 404);
  const { version } = await c.req.json<{ version?: string | null }>().catch(() => ({ version: undefined }));
  if (version !== null && (typeof version !== "string" || !VERSION_RE.test(version))) {
    return c.json({ error: "version must be a semver string like v1.2.3, or null" }, 400);
  }
  await db.batch([
    db.prepare("UPDATE clients SET target_version = ? WHERE id = ?").bind(version, client.id),
    eventStmt(db, "upgrade_requested", client.id, { version, by: c.get("adminEmail") }),
  ]);
  return c.json({ ok: true });
});

adminApi.get("/releases/latest", async (c) => c.json({ version: await latestVersion(c.env) }));

adminApi.get("/settings", async (c) => c.json({ settings: await getSettings(c.env.DB) }));

adminApi.put("/settings", async (c) => {
  const body = await c.req.json<Partial<Settings>>().catch(() => ({}) as Partial<Settings>);
  const patch: Partial<Settings> = {};
  if (body.registration_open !== undefined) {
    if (typeof body.registration_open !== "boolean") return c.json({ error: "registration_open must be a boolean" }, 400);
    patch.registration_open = body.registration_open;
  }
  if (body.approval_timeout_seconds !== undefined) {
    const v = body.approval_timeout_seconds;
    if (!Number.isInteger(v) || v < 30 || v > 86400) {
      return c.json({ error: "approval_timeout_seconds must be an integer between 30 and 86400" }, 400);
    }
    patch.approval_timeout_seconds = v;
  }
  if (body.heartbeat_interval_seconds !== undefined) {
    const v = body.heartbeat_interval_seconds;
    if (!Number.isInteger(v) || v < 15 || v > 3600) {
      return c.json({ error: "heartbeat_interval_seconds must be an integer between 15 and 3600" }, 400);
    }
    patch.heartbeat_interval_seconds = v;
  }
  if (body.target_client_version !== undefined) {
    const v = body.target_client_version;
    if (typeof v !== "string" || (v !== "" && !VERSION_RE.test(v))) {
      return c.json({ error: "target_client_version must be a semver string or empty" }, 400);
    }
    patch.target_client_version = v;
  }
  await updateSettings(c.env.DB, patch);
  if (Object.keys(patch).length) await logEvent(c.env.DB, "settings_changed", null, { ...patch, by: c.get("adminEmail") });
  return c.json({ settings: await getSettings(c.env.DB) });
});

adminApi.get("/blocked-ips", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM blocked_ips ORDER BY blocked_at DESC").all();
  return c.json({ blocked_ips: results });
});

adminApi.delete("/blocked-ips/:ip", async (c) => {
  const db = c.env.DB;
  const ip = c.req.param("ip");
  const res = await db.prepare("DELETE FROM blocked_ips WHERE ip = ?").bind(ip).run();
  if (!res.meta.changes) return c.json({ error: "not found" }, 404);
  await logEvent(db, "unblocked", null, { ip, by: c.get("adminEmail") });
  return c.json({ ok: true });
});

adminApi.get("/events", async (c) => {
  const clientId = c.req.query("client_id");
  const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);
  const stmt = clientId
    ? c.env.DB.prepare("SELECT * FROM events WHERE client_id = ? ORDER BY id DESC LIMIT ?").bind(clientId, limit)
    : c.env.DB.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").bind(limit);
  const { results } = await stmt.all<{ detail: string | null }>();
  return c.json({ events: results.map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null })) });
});
