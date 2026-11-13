# cloudflare-ddns

Self-hosted dynamic DNS for domains on Cloudflare. A small client runs on each
machine, and a Cloudflare Worker keeps that machine's DNS record pointed at its
current public IP. A web dashboard shows every client and record and lets you
manage them remotely.

You deploy it to your own Cloudflare account ([docs/deployment.md](docs/deployment.md));
`ddns.example.com` in the docs stands for your hostname.

## Why I built this

I manage a handful of domains on Cloudflare, and some of their records have to
follow machines whose public IP changes (home servers, family computers, small
offices). I tried the usual answers first and none of them fit:

- **DDNS providers** (No-IP, DuckDNS, DynDNS and friends) give you a name on
  *their* domain, or charge to use yours. My domains are already on
  Cloudflare, so I wanted the records to live there, with no extra provider
  in the middle.
- **Router DDNS** depends on what each router supports, and many don't
  support Cloudflare at all.
- **Scripts and open source updaters** (ddclient, a cron job with `curl`,
  the many `cloudflare-ddns` containers) work well for one machine. With
  several, the pattern they share starts to hurt:
  - every machine holds a Cloudflare API token that can edit DNS, so one
    compromised or lost machine puts the zone at risk;
  - every machine has its own config file with the zone, record and token,
    edited by hand over SSH or remote desktop;
  - there is no single place to see which machines are alive, what IP each
    record has and when it last changed;
  - upgrading means visiting every machine again.

What I wanted was closer to a small fleet manager than to a script:

- **No secrets on the machines.** The client never sees a Cloudflare token.
  It only says "I'm here", and the Worker reads the public IP from the
  request and updates DNS itself.
- **Install with one line and no questions**, on Linux, macOS and Windows.
  Everything else (which zone, which record) is decided in the dashboard.
- **One dashboard** with every record, its IP, whether the client is
  connected and when it last updated.
- **Remote upgrades**, so I never have to log in to a machine again.
- **Nothing to host.** It runs entirely on Cloudflare (Worker, D1, R2,
  Access), within the free plans for a setup like mine.

If you have one machine, a simple updater script is probably all you need.
If you have several, in places you can't easily reach, this is for you.

## How it works

```
 machine (ddns-client)                 Cloudflare
 ┌─────────────────┐  heartbeat   ┌──────────────────────────┐   DNS API   ┌───────────┐
 │ registers once, │ ───────────▶ │ Worker                   │ ──────────▶ │ A record  │
 │ then heartbeats │ ◀─────────── │  - reads caller's IP     │             │ home.x.com│
 │ every 60s       │  config /    │  - D1: clients, settings │             └───────────┘
 └─────────────────┘  upgrades    │  - dashboard (Access)    │
                                  └──────────────────────────┘
```

- **The client is dumb on purpose.** It doesn't detect its own IP and never
  holds a Cloudflare token. The Worker reads the public IPv4 from the
  heartbeat request (`CF-Connecting-IP`) and updates the record itself.
- **Zero-input install.** A one-liner installs the client as a service. The
  new machine shows up in the dashboard as *pending*, and you choose its zone
  and record name there.
- **Locked down by default.** Registration only works while you have
  *Listen for new clients* turned on. A pending client that isn't approved in
  time (5 minutes by default) is rejected and its IP is blocked until you
  unblock it. Pending clients can never change DNS.
- **One machine, one record.** Each client owns a single A record (IPv4).
- **Remote upgrades.** The dashboard sets a target client version; clients
  upgrade themselves on their next heartbeat.
- **Dashboard login** is handled by Cloudflare Access.

## Using it

See the **[user guide](docs/user-guide.md)** for installing clients, approving
them, and managing records.

## Repository layout

| Path | What |
| --- | --- |
| `server/` | Cloudflare Worker (Hono + TypeScript): client API, admin API, downloads, dashboard hosting |
| `dashboard/` | Web dashboard (React + Vite, installable as an app), served by the Worker as static assets |
| `server/migrations/` | D1 schema migrations |
| `client/` | Go client agent (`cmd/ddns-client`) |
| `install/` | `install.sh` / `install.ps1` one-liner installers |
| `docs/` | User guide, API reference and deployment guide |
| `.claude/` | Project skills and settings for developing with Claude Code |

## Development

Requirements: Node 22+, Go 1.24+.

```bash
# Server
cd server
npm ci
npm run db:migrate:local   # create the local D1 schema
npm run dev                # http://localhost:8787
npm run typecheck && npm test

# Dashboard (with the Worker running on :8787 and ALLOW_INSECURE_ADMIN=true in server/.dev.vars)
cd dashboard
npm ci
npm run dev                # http://localhost:5173, proxies /api to the Worker

# Client
cd client
go vet ./... && go test ./...
go build -o bin/ddns-client ./cmd/ddns-client
```

CI runs the same checks on every push
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Deployment

Each release deploys automatically once the one-time Cloudflare setup is
done; pushes to `development` alone never reach production. See **[docs/deployment.md](docs/deployment.md)**.

## License

[MIT](LICENSE)
