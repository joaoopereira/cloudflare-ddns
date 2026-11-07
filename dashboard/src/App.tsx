import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { BlockedPage } from "./pages/Blocked";
import { ClientsPage } from "./pages/Clients";
import { EventsPage } from "./pages/Events";
import { SettingsPage } from "./pages/Settings";

const PAGES = {
  clients: { label: "Clients", component: ClientsPage },
  blocked: { label: "Blocked IPs", component: BlockedPage },
  activity: { label: "Activity", component: EventsPage },
  settings: { label: "Settings", component: SettingsPage },
} as const;
type PageKey = keyof typeof PAGES;

function pageFromHash(): PageKey {
  const key = location.hash.replace(/^#\/?/, "");
  return key in PAGES ? (key as PageKey) : "clients";
}

export interface PageProps {
  notify: (msg: string, kind?: "error" | "info") => void;
}

export function App() {
  const [page, setPage] = useState<PageKey>(pageFromHash);
  const [email, setEmail] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: "error" | "info" } | null>(null);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    api
      .me()
      .then((r) => setEmail(r.email))
      .catch((e: Error) => setAuthError(e.message));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((msg: string, kind: "error" | "info" = "error") => setToast({ msg, kind }), []);
  const Page = PAGES[page].component;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◎
          </span>
          DDNS
        </div>
        <nav>
          {(Object.keys(PAGES) as PageKey[]).map((key) => (
            <a key={key} href={`#/${key}`} className={key === page ? "active" : undefined}>
              {PAGES[key].label}
            </a>
          ))}
        </nav>
        <div className="who">{email}</div>
      </header>
      <main>
        {authError ? (
          <div className="card empty">
            <h2>Can't reach the admin API</h2>
            <p className="muted">{authError}</p>
            <p className="muted">
              Check that Cloudflare Access is set up and the Worker has <code>ACCESS_TEAM_DOMAIN</code> and{" "}
              <code>ACCESS_AUD</code> (see docs/deployment.md).
            </p>
          </div>
        ) : (
          <Page notify={notify} />
        )}
      </main>
      {toast && (
        <div className={`toast ${toast.kind}`} role="status" onClick={() => setToast(null)}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
