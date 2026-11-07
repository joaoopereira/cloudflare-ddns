export interface Settings {
  registration_open: boolean;
  approval_timeout_seconds: number;
  heartbeat_interval_seconds: number;
  target_client_version: string;
}

export const DEFAULT_SETTINGS: Settings = {
  registration_open: false,
  approval_timeout_seconds: 300,
  heartbeat_interval_seconds: 60,
  target_client_version: "",
};

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const raw = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    registration_open: raw.registration_open === "true",
    approval_timeout_seconds: Number(raw.approval_timeout_seconds ?? DEFAULT_SETTINGS.approval_timeout_seconds),
    heartbeat_interval_seconds: Number(raw.heartbeat_interval_seconds ?? DEFAULT_SETTINGS.heartbeat_interval_seconds),
    target_client_version: raw.target_client_version ?? "",
  };
}

export async function updateSettings(db: D1Database, patch: Partial<Settings>): Promise<void> {
  const stmts = Object.entries(patch).map(([key, value]) =>
    db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .bind(key, String(value)),
  );
  if (stmts.length) await db.batch(stmts);
}
