import { useCallback } from "react";
import type { PageProps } from "../App";
import { api, type EventRow } from "../api";
import { ago, fullDate } from "../format";
import { usePolling } from "../hooks";

const LABELS: Record<string, string> = {
  registered: "Registered",
  approved: "Approved",
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
      return `${d.from} → ${d.to}`;
    case "approved":
      return `${d.record}${d.by ? ` by ${d.by}` : ""}`;
    case "blocked":
    case "unblocked":
      return `${d.ip}${d.reason ? ` (${d.reason})` : ""}`;
    default:
      return Object.entries(d)
        .filter(([k]) => k !== "by")
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(", ");
  }
}

export function EventsPage(_: PageProps) {
  const { data, error } = usePolling(useCallback(() => api.events(), []));
  if (error && !data) return <div className="card empty">Failed to load: {error.message}</div>;
  if (!data) return <div className="card empty muted">Loading…</div>;
  return (
    <section>
      <h3 className="section-title">Activity</h3>
      {data.length === 0 ? (
        <div className="card empty muted">Nothing yet.</div>
      ) : (
        <div className="card">
          <ul className="timeline">
            {data.map((e) => (
              <li key={e.id} className={e.type === "dns_error" ? "error-text" : undefined}>
                <span className="when" title={fullDate(e.created_at)}>
                  {ago(e.created_at)}
                </span>
                <span className="what">{LABELS[e.type] ?? e.type}</span>
                <span className="detail">{describe(e)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
