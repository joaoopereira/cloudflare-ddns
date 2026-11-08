import { useCallback } from "react";
import type { PageProps } from "../App";
import { api, type Client, type EventRow } from "../api";
import { ago, clientLabel, fullDate, ver } from "../format";
import { usePolling } from "../hooks";

const LABELS: Record<string, string> = {
  registered: "Registered",
  approved: "Approved",
  renamed: "Renamed",
  rejected: "Rejected",
  revoked: "Revoked",
  deleted: "Deleted",
  blocked: "IP blocked",
  unblocked: "IP unblocked",
  ip_changed: "IP changed",
  dns_error: "DNS error",
  upgrade_requested: "Upgrade requested",
  upgraded: "Upgraded",
  settings_changed: "Settings changed",
};

function describe(e: EventRow): string {
  const d = e.detail ?? {};
  switch (e.type) {
    case "ip_changed":
      return `${d.record}: ${d.from ?? "none"} → ${d.to}`;
    case "upgraded":
      return `${ver(d.from as string) ?? "?"} → ${ver(d.to as string)}`;
    case "upgrade_requested":
      return d.version ? `to ${ver(d.version as string)}${d.by ? ` by ${d.by}` : ""}` : `override cleared${d.by ? ` by ${d.by}` : ""}`;
    case "approved":
      return `${d.record}${d.by ? ` by ${d.by}` : ""}`;
    case "renamed":
      return `${d.from ?? "(no name)"} → ${d.to ?? "(no name)"}`;
    case "blocked":
    case "unblocked":
      return `${d.ip}${d.reason ? ` (${d.reason})` : ""}`;
    default:
      return Object.entries(d)
        .filter(([k]) => k !== "by")
        .map(([k, v]) => `${k}: ${typeof v === "string" ? ver(v) : String(v)}`)
        .join(", ");
  }
}

/** Who an event is about: the client's current label, or what the event recorded if it was deleted. */
function clientName(e: EventRow, client: Client | undefined): string {
  if (client) return clientLabel(client);
  const d = e.detail ?? {};
  return String(d.name ?? d.record ?? e.client_id!.slice(0, 8));
}

export function EventsPage(_: PageProps) {
  const { data, error } = usePolling(
    useCallback(async () => {
      const [events, clients] = await Promise.all([api.events(), api.clients().catch(() => [] as Client[])]);
      return { events, clients: new Map(clients.map((c) => [c.id, c])) };
    }, []),
  );
  if (error && !data) return <div className="card empty">Failed to load: {error.message}</div>;
  if (!data) return <div className="card empty muted">Loading…</div>;
  return (
    <section>
      <h3 className="section-title">Activity</h3>
      {data.events.length === 0 ? (
        <div className="card empty muted">Nothing yet.</div>
      ) : (
        <div className="card">
          <ul className="timeline">
            {data.events.map((e) => (
              <li key={e.id} className={e.type === "dns_error" ? "error-text" : undefined}>
                <span className="when" title={fullDate(e.created_at)}>
                  {ago(e.created_at)}
                </span>
                <span className="what">{LABELS[e.type] ?? e.type}</span>
                <span className="detail">
                  {e.client_id && <strong>{clientName(e, data.clients.get(e.client_id))}: </strong>}
                  {describe(e)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
