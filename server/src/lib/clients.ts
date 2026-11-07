import { eventStmt } from "./events";
import { getSettings } from "./settings";
import { now } from "./util";

export type ClientStatus = "pending" | "approved" | "rejected" | "revoked";

export interface ClientRow {
  id: string;
  secret_hash: string;
  status: ClientStatus;
  hostname: string | null;
  os: string | null;
  arch: string | null;
  version: string | null;
  registered_ip: string;
  current_ip: string | null;
  zone_id: string | null;
  zone_name: string | null;
  record_name: string | null;
  record_id: string | null;
  last_error: string | null;
  first_seen: number;
  last_seen: number | null;
  last_ip_change: number | null;
  approved_at: number | null;
  target_version: string | null;
}

export function getClient(db: D1Database, id: string): Promise<ClientRow | null> {
  return db.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first<ClientRow>();
}

export async function isBlocked(db: D1Database, ip: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM blocked_ips WHERE ip = ?").bind(ip).first()) !== null;
}

export function blockIpStmt(db: D1Database, ip: string, reason: string): D1PreparedStatement {
  return db
    .prepare("INSERT INTO blocked_ips (ip, reason, blocked_at) VALUES (?, ?, ?) ON CONFLICT (ip) DO NOTHING")
    .bind(ip, reason, now());
}

/** Reject a client and block the IP it registered from. */
export async function rejectAndBlock(db: D1Database, client: ClientRow, reason: string): Promise<void> {
  await db.batch([
    db.prepare("UPDATE clients SET status = 'rejected' WHERE id = ?").bind(client.id),
    blockIpStmt(db, client.registered_ip, reason),
    eventStmt(db, "rejected", client.id, { reason }),
    eventStmt(db, "blocked", client.id, { ip: client.registered_ip, reason }),
  ]);
}

/**
 * Pending clients that were not approved within the approval timeout are
 * rejected and their IP is blocked. Called lazily on client requests and from
 * the cron trigger. Returns the number of clients expired.
 */
export async function expirePendingClients(db: D1Database): Promise<number> {
  const { approval_timeout_seconds } = await getSettings(db);
  const cutoff = now() - approval_timeout_seconds;
  const { results } = await db
    .prepare("SELECT * FROM clients WHERE status = 'pending' AND first_seen <= ?")
    .bind(cutoff)
    .all<ClientRow>();
  for (const client of results) await rejectAndBlock(db, client, "approval timeout");
  return results.length;
}
