import { useEffect, useState } from "react";
import type { PageProps } from "../App";
import { api, type Settings } from "../api";
import { useAction } from "../hooks";

export function SettingsPage({ notify }: PageProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [timeoutMin, setTimeoutMin] = useState("");
  const { busy, run } = useAction(notify);

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSettings(s);
        setTimeoutMin(String(s.approval_timeout_seconds / 60));
      })
      .catch((e: Error) => notify(e.message));
  }, [notify]);

  if (!settings) return <div className="card empty muted">Loading…</div>;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const seconds = Math.round(Number(timeoutMin) * 60);
    run(async () => {
      setSettings(await api.updateSettings({ approval_timeout_seconds: seconds }));
      notify("Settings saved", "info");
    });
  };

  return (
    <section>
      <h3 className="section-title">Settings</h3>
      <form className="card settings" onSubmit={save}>
        <label>
          Approval timeout
          <div className="suffix-input narrow">
            <input
              type="number"
              min={0.5}
              max={1440}
              step={0.5}
              value={timeoutMin}
              onChange={(e) => setTimeoutMin(e.target.value)}
              required
            />
            <span className="muted">minutes</span>
          </div>
          <span className="muted small">
            A pending client not approved within this time is rejected and its public IP is blocked.
          </span>
        </label>
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
      <p className="muted small">
        Clients send a heartbeat every {settings.heartbeat_interval_seconds}s and count as offline after{" "}
        {settings.heartbeat_interval_seconds * 3}s without one.
        {settings.target_client_version && <> All clients are being upgraded to {settings.target_client_version}.</>}
      </p>
    </section>
  );
}
