import { now } from "./util";

export type EventType =
  | "registered"
  | "approved"
  | "renamed"
  | "rejected"
  | "revoked"
  | "deleted"
  | "blocked"
  | "unblocked"
  | "ip_changed"
  | "dns_error"
  | "upgrade_requested"
  | "upgraded"
  | "settings_changed";

export function eventStmt(
  db: D1Database,
  type: EventType,
  clientId: string | null,
  detail?: Record<string, unknown>,
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO events (client_id, type, detail, created_at) VALUES (?, ?, ?, ?)")
    .bind(clientId, type, detail ? JSON.stringify(detail) : null, now());
}

export async function logEvent(
  db: D1Database,
  type: EventType,
  clientId: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  await eventStmt(db, type, clientId, detail).run();
}
