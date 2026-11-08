/** Longest friendly name the server accepts. */
export const NAME_MAX = 64;

export type ClientStatus = "pending" | "approved" | "rejected" | "revoked";

export interface Client {
  id: string;
  status: ClientStatus;
  name: string | null;
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

/** Fired on `window` when the Cloudflare Access session is gone (see App). */
export const SESSION_EXPIRED = "ddns:session-expired";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    // When the Access session has expired, Access answers with a redirect to
    // its login page. Following it from fetch() only ends in a CORS error, so
    // catch it here and let the app send the whole page through the login.
    redirect: "manual",
  });
  if (res.type === "opaqueredirect" || res.status === 401) {
    dispatchEvent(new Event(SESSION_EXPIRED));
    throw new ApiError("Your sign-in has expired", 401);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status);
  return data;
}

export const api = {
  me: () => request<{ email: string | null }>("GET", "/me"),
  clients: () => request<{ clients: Client[] }>("GET", "/clients").then((r) => r.clients),
  zones: () => request<{ zones: Zone[] }>("GET", "/zones").then((r) => r.zones),
  approve: (id: string, zone_id: string, record_name: string, name: string | null) =>
    request("POST", `/clients/${encodeURIComponent(id)}/approve`, { zone_id, record_name, name }),
  rename: (id: string, name: string | null) => request("PATCH", `/clients/${encodeURIComponent(id)}`, { name }),
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

export interface Health {
  ok: boolean;
  version: string;
  commit: string | null;
}

/** Public health check; also reports the deployed Worker version. */
export async function health(): Promise<Health> {
  const res = await fetch("/health", { cache: "no-store" });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as Health;
}
