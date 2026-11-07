import { useCallback, useState } from "react";
import type { PageProps } from "../App";
import { api, type Client } from "../api";
import { InstallCommands } from "../components/InstallCommands";
import { RecordDialog } from "../components/RecordDialog";
import { ago, countdown, fullDate, osLabel } from "../format";
import { useAction, usePolling, useTick } from "../hooks";

export function ClientsPage({ notify }: PageProps) {
  const load = useCallback(
    async () => {
      const [clients, settings, latest] = await Promise.all([
        api.clients(),
        api.settings(),
        api.latestRelease().catch(() => null),
      ]);
      return { clients, settings, latest };
    },
    [],
  );
  const { data, error, reload } = usePolling(load, 5000);
  const { busy, run } = useAction(notify);
  const [dialog, setDialog] = useState<{ client: Client; mode: "approve" | "edit" } | null>(null);
  useTick();

  if (error && !data) return <div className="card empty">Failed to load: {error.message}</div>;
  if (!data) return <div className="card empty muted">Loading…</div>;

  const { clients, settings, latest } = data;
  const pending = clients.filter((c) => c.status === "pending");
  const active = clients.filter((c) => c.status === "approved" || c.status === "revoked");
  const outdated = latest ? active.filter((c) => c.status === "approved" && c.version !== latest) : [];

  const toggle = () =>
    run(async () => {
      await api.updateSettings({ registration_open: !settings.registration_open });
      await reload();
    });

  return (
    <>
      <section className={`card listen ${settings.registration_open ? "on" : ""}`}>
        <div className="listen-head">
          <div>
            <h2>
              {settings.registration_open ? (
                <>
                  <span className="pulse" /> Listening for new clients
                </>
              ) : (
                "Add a machine"
              )}
            </h2>
            <p className="muted">
              {settings.registration_open
                ? `Run the installer on the new machine. It will appear below; approve it within ${Math.round(settings.approval_timeout_seconds / 60)} min or its IP gets blocked.`
                : "New machines can only register while listening is on."}
            </p>
          </div>
          <button className={settings.registration_open ? "" : "primary"} onClick={toggle} disabled={busy}>
            {settings.registration_open ? "Stop listening" : "Listen for new clients"}
          </button>
        </div>
        {settings.registration_open && <InstallCommands />}
      </section>

      {pending.length > 0 && (
        <section>
          <h3 className="section-title">Pending approval</h3>
          <div className="pending-grid">
            {pending.map((c) => (
              <div className="card pending" key={c.id}>
                <div className="pending-head">
                  <strong>{c.hostname ?? c.id.slice(0, 8)}</strong>
                  {c.approval_deadline && (
                    <span className="badge warn" title="Time left before it is rejected and its IP blocked">
                      {countdown(c.approval_deadline)}
                    </span>
                  )}
                </div>
                <dl>
                  <dt>Public IP</dt>
                  <dd className="mono">{c.registered_ip}</dd>
                  <dt>System</dt>
                  <dd>{osLabel(c.os, c.arch)}</dd>
                  <dt>Version</dt>
                  <dd>{c.version ?? "?"}</dd>
                  <dt>Seen</dt>
                  <dd title={fullDate(c.first_seen)}>{ago(c.first_seen)}</dd>
                </dl>
                <div className="actions">
                  <button className="ghost danger" disabled={busy} onClick={() => run(async () => (await api.reject(c.id), reload()))}>
                    Reject
                  </button>
                  <button className="primary" onClick={() => setDialog({ client: c, mode: "approve" })}>
                    Approve…
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="section-row">
          <h3 className="section-title">Clients</h3>
          {latest && (
            <div className="muted small">
              Latest release <strong>{latest}</strong>
              {outdated.length > 0 && (
                <button
                  className="ghost small-btn"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api.updateSettings({ target_client_version: latest });
                      notify(`Upgrading ${outdated.length} client(s) to ${latest}`, "info");
                      await reload();
                    })
                  }
                >
                  Upgrade all ({outdated.length})
                </button>
              )}
            </div>
          )}
        </div>
        {active.length === 0 ? (
          <div className="card empty muted">No clients yet. Turn on listening and run the installer on a machine.</div>
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Record</th>
                  <th>IP</th>
                  <th>Status</th>
                  <th className="hide-sm">IP updated</th>
                  <th className="hide-sm">Machine</th>
                  <th className="hide-sm">Version</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {active.map((c) => (
                  <ClientRow
                    key={c.id}
                    client={c}
                    latest={latest}
                    busy={busy}
                    run={run}
                    reload={reload}
                    onEdit={() => setDialog({ client: c, mode: "edit" })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog && (
        <RecordDialog
          client={dialog.client}
          title={dialog.mode === "approve" ? "Approve client" : "Change record"}
          submitLabel={dialog.mode === "approve" ? "Approve" : "Save"}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
          notify={notify}
        />
      )}
    </>
  );
}

function ClientRow({
  client: c,
  latest,
  busy,
  run,
  reload,
  onEdit,
}: {
  client: Client;
  latest: string | null;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  reload: () => Promise<void>;
  onEdit: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const upgrading = c.effective_target_version && c.effective_target_version !== c.version;
  const status =
    c.status === "revoked" ? (
      <span className="badge muted-badge">Revoked</span>
    ) : c.online ? (
      <span className="badge ok">Online</span>
    ) : (
      <span className="badge off" title={`Last seen ${ago(c.last_seen)}`}>
        Offline
      </span>
    );

  return (
    <tr>
      <td>
        <div className="mono strong">{c.record_name}</div>
        {c.last_error && (
          <div className="error-text small" title={c.last_error}>
            ⚠ {c.last_error}
          </div>
        )}
      </td>
      <td className="mono">{c.current_ip ?? <span className="muted">pending first update</span>}</td>
      <td>
        {status}
        <div className="muted small" title={fullDate(c.last_seen)}>
          seen {ago(c.last_seen)}
        </div>
      </td>
      <td className="hide-sm" title={fullDate(c.last_ip_change)}>
        {ago(c.last_ip_change)}
      </td>
      <td className="hide-sm">
        <div>{c.hostname ?? "?"}</div>
        <div className="muted small">{osLabel(c.os, c.arch)}</div>
      </td>
      <td className="hide-sm">
        <div>{c.version ?? "?"}</div>
        {upgrading && <div className="muted small">→ {c.effective_target_version}</div>}
      </td>
      <td className="row-actions">
        <button className="ghost" onClick={() => setMenu((m) => !m)} aria-label="Actions">
          ⋯
        </button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            {c.status === "approved" && <button onClick={() => (setMenu(false), onEdit())}>Change record…</button>}
            {latest && c.version !== latest && c.status === "approved" && (
              <button
                disabled={busy}
                onClick={() => run(async () => (setMenu(false), await api.upgrade(c.id, latest), reload()))}
              >
                Upgrade to {latest}
              </button>
            )}
            {c.target_version && (
              <button disabled={busy} onClick={() => run(async () => (setMenu(false), await api.upgrade(c.id, null), reload()))}>
                Cancel upgrade override
              </button>
            )}
            {c.status === "approved" && (
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  confirm(`Revoke ${c.record_name}? It will stop updating DNS.`) &&
                  run(async () => (setMenu(false), await api.revoke(c.id), reload()))
                }
              >
                Revoke
              </button>
            )}
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                if (!confirm(`Delete ${c.hostname ?? c.id}?`)) return;
                const deleteRecord = !!c.record_name && confirm(`Also delete the DNS record ${c.record_name}?`);
                run(async () => (setMenu(false), await api.remove(c.id, deleteRecord), reload()));
              }}
            >
              Delete…
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
