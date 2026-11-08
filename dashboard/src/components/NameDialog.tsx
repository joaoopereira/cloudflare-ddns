import { useState } from "react";
import { api, NAME_MAX, type Client } from "../api";
import { touchScreen } from "../format";

/** Set or clear a client's friendly name. */
export function NameDialog({
  client,
  onClose,
  onDone,
  notify,
}: {
  client: Client;
  onClose: () => void;
  onDone: () => void;
  notify: (msg: string) => void;
}) {
  const [name, setName] = useState(client.name ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.rename(client.id, name.trim() || null);
      onDone();
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <h2>Rename client</h2>
        <p className="muted">
          {client.hostname ?? client.id}
          {client.record_name ? ` · ${client.record_name}` : ""}
        </p>
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={client.hostname ?? "Home NAS"}
            maxLength={NAME_MAX}
            autoCapitalize="words"
            enterKeyHint="done"
            autoFocus={!touchScreen()}
          />
        </label>
        <p className="muted small">Leave empty to show the hostname instead.</p>
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
