import { useEffect, useMemo, useState } from "react";
import { api, type Client, type Zone } from "../api";

interface Props {
  client: Client;
  title: string;
  submitLabel: string;
  onClose: () => void;
  onDone: () => void;
  notify: (msg: string) => void;
}

/** Pick a zone and record name for a client (used to approve and to edit). */
export function RecordDialog({ client, title, submitLabel, onClose, onDone, notify }: Props) {
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [zoneId, setZoneId] = useState(client.zone_id ?? "");
  const initialName =
    client.record_name && client.zone_name
      ? client.record_name === client.zone_name
        ? "@"
        : client.record_name.slice(0, -(client.zone_name.length + 1))
      : (client.hostname ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .zones()
      .then((z) => {
        setZones(z);
        if (!zoneId && z.length) setZoneId(z[0].id);
      })
      .catch((e: Error) => notify(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zone = zones?.find((z) => z.id === zoneId);
  const fqdn = useMemo(() => {
    if (!zone) return "";
    const n = name.trim().toLowerCase();
    return n === "@" || n === "" ? zone.name : `${n.replace(new RegExp(`\\.${zone.name}$`), "")}.${zone.name}`;
  }, [zone, name]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.approve(client.id, zoneId, name.trim() || "@");
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
        <h2>{title}</h2>
        <p className="muted">
          {client.hostname ?? client.id} · {client.registered_ip}
        </p>
        <label>
          Zone
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={!zones} required>
            {!zones && <option>Loading…</option>}
            {zones?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Record name
          <div className="suffix-input">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="home" autoFocus />
            <span className="muted">.{zone?.name ?? "…"}</span>
          </div>
        </label>
        {fqdn && (
          <p className="muted small">
            This machine's public IP will be published as an A record for <strong>{fqdn}</strong>.
          </p>
        )}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !zoneId}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
