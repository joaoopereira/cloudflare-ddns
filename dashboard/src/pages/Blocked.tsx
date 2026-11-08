import { useCallback } from "react";
import type { PageProps } from "../App";
import { api } from "../api";
import { ago, fullDate } from "../format";
import { useAction, usePolling } from "../hooks";

export function BlockedPage({ notify }: PageProps) {
  const { data, error, reload } = usePolling(useCallback(() => api.blockedIps(), []));
  const { busy, run } = useAction(notify);

  if (error && !data) return <div className="card empty">Failed to load: {error.message}</div>;
  if (!data) return <div className="card empty muted">Loading…</div>;

  return (
    <section>
      <h3 className="section-title">Blocked IPs</h3>
      <p className="muted">
        These addresses can't register new clients. Unblocking lets a machine behind the IP show up as pending again on
        its next retry (within a few minutes), as long as listening is on.
      </p>
      {data.length === 0 ? (
        <div className="card empty muted">No blocked IPs.</div>
      ) : (
        <div className="card table-wrap">
          <table className="cards-sm">
            <thead>
              <tr>
                <th>IP</th>
                <th>Reason</th>
                <th>Blocked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.ip}>
                  <td className="mono strong">{b.ip}</td>
                  <td data-label="Reason">{b.reason}</td>
                  <td data-label="Blocked" title={fullDate(b.blocked_at)}>{ago(b.blocked_at)}</td>
                  <td className="row-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api.unblock(b.ip);
                          notify(`${b.ip} unblocked`, "info");
                          await reload();
                        })
                      }
                    >
                      Unblock
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
