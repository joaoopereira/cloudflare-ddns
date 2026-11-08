import { useCallback, useEffect, useState } from "react";
import { api, health, SESSION_EXPIRED, type Health } from "./api";
import { ver } from "./format";
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

  const expired = useSessionExpired();

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
        {expired ? (
          <div className="card empty">
            <h2>Signed out</h2>
            <p className="muted">Your Cloudflare Access session has expired.</p>
            <div className="actions center">
              <button className="primary" onClick={() => location.reload()}>
                Sign in again
              </button>
            </div>
          </div>
        ) : authError ? (
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
      <Footer />
      {toast && (
        <div className={`toast ${toast.kind}`} role="status" onClick={() => setToast(null)}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/** Don't reload for a new sign-in more than once in this window, to avoid a loop. */
const RELOGIN_GUARD_MS = 2 * 60_000;
const RELOGIN_KEY = "ddns:relogin-at";

/**
 * When the Access session expires (for example, the installed app was in the
 * background for a day), reload the page: the navigation goes through Access,
 * which shows its login and comes back. If that already happened moments ago,
 * show a "Sign in again" button instead of reloading in a loop.
 */
function useSessionExpired(): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const onExpired = () => {
      setExpired(true);
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(RELOGIN_KEY)) || 0;
        if (Date.now() - last > RELOGIN_GUARD_MS) sessionStorage.setItem(RELOGIN_KEY, String(Date.now()));
      } catch {
        last = Date.now(); // no storage: never auto-reload
      }
      if (Date.now() - last > RELOGIN_GUARD_MS) location.reload();
    };
    addEventListener(SESSION_EXPIRED, onExpired);
    return () => removeEventListener(SESSION_EXPIRED, onExpired);
  }, []);
  return expired;
}

/** Every 5 minutes, check which version the Worker is running. */
const VERSION_CHECK_MS = 5 * 60_000;

/**
 * App version from the build (e.g. "DDNS 1.1.0 · abc1234"). If the Worker
 * reports a different commit, this tab is running an old bundle: offer a reload.
 */
function Footer() {
  const [server, setServer] = useState<Health | null>(null);
  useEffect(() => {
    const check = () => health().then(setServer, () => undefined);
    check();
    const t = setInterval(check, VERSION_CHECK_MS);
    return () => clearInterval(t);
  }, []);
  const stale = !!server?.commit && !!__APP_COMMIT__ && server.commit !== __APP_COMMIT__;
  return (
    <footer className="footer">
      <span title={server ? `Server ${ver(server.version)}${server.commit ? ` · ${server.commit}` : ""}` : undefined}>
        DDNS {ver(__APP_VERSION__)}
        {__APP_COMMIT__ && <span className="mono"> · {__APP_COMMIT__}</span>}
      </span>
      {stale && (
        <span className="stale">
          A newer version ({ver(server.version)} · {server.commit}) is deployed.{" "}
          <button className="small-btn" onClick={() => location.reload()}>
            Reload
          </button>
        </span>
      )}
    </footer>
  );
}
