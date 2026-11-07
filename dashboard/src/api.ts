export type ClientStatus = "pending" | "approved" | "rejected" | "revoked";

export interface Client {
  id: string;
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
  last_error: string | null;
  first_seen: number;
  last_seen: number | null;
  last_ip_change: number | null;
  approved_at: number | null;
  target_version: string | null;
  online: boolean;
  approval_deadline: number | null;
  effective_target_version: string | null;
}

export interface Settings {
  registration_open: boolean;
  approval_timeout_seconds: number;
  heartbeat_interval_seconds: number;
  target_client_version: string;
}

export interface Zone {
  id: string;
  name: string;
}

export interface BlockedIp {
  ip: string;
  reason: string;
  blocked_at: number;
}

export interface EventRow {
  id: number;
  client_id: string | null;
  type: string;
  detail: Record<string, unknown> | null;
  created_at: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status);
  return data;
}

export const api = {
  me: () => request<{ email: string | null }>("GET", "/me"),
  clients: () => request<{ clients: Client[] }>("GET", "/clients").then((r) => r.clients),
  zones: () => request<{ zones: Zone[] }>("GET", "/zones").then((r) => r.zones),
  approve: (id: string, zone_id: string, record_name: string) =>
    request("POST", `/clients/${encodeURIComponent(id)}/approve`, { zone_id, record_name }),
  reject: (id: string) => request("POST", `/clients/${encodeURIComponent(id)}/reject`),
  revoke: (id: string) => request("POST", `/clients/${encodeURIComponent(id)}/revoke`),
  remove: (id: string, deleteRecord: boolean) =>
    request("DELETE", `/clients/${encodeURIComponent(id)}${deleteRecord ? "?delete_record=true" : ""}`),
  upgrade: (id: string, version: string | null) => request("POST", `/clients/${encodeURIComponent(id)}/upgrade`, { version }),
  latestRelease: () => request<{ version: string | null }>("GET", "/releases/latest").then((r) => r.version),
  settings: () => request<{ settings: Settings }>("GET", "/settings").then((r) => r.settings),
  updateSettings: (patch: Partial<Settings>) =>
    request<{ settings: Settings }>("PUT", "/settings", patch).then((r) => r.settings),
  blockedIps: () => request<{ blocked_ips: BlockedIp[] }>("GET", "/blocked-ips").then((r) => r.blocked_ips),
  unblock: (ip: string) => request("DELETE", `/blocked-ips/${encodeURIComponent(ip)}`),
  events: (clientId?: string) =>
    request<{ events: EventRow[] }>("GET", `/events${clientId ? `?client_id=${encodeURIComponent(clientId)}` : ""}`).then(
      (r) => r.events,
    ),
};
