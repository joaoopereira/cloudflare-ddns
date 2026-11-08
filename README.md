# cloudflare-ddns

Self-hosted dynamic DNS for domains on Cloudflare. A small client runs on each
machine, and a Cloudflare Worker keeps that machine's DNS record pointed at its
current public IP. A web dashboard shows every client and record and lets you
manage them remotely.

The app runs at **https://ddns.apps.joaoopereira.com**.

> **Status:** the MVP is complete: Worker ([API reference](docs/api.md)), Go
> client, installers and dashboard. Follow [docs/deployment.md](docs/deployment.md)
> to go live. See the
> [backlog](https://github.com/joaoopereira/cloudflare-ddns/issues).

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
| `dashboard/` | Web dashboard (React + Vite), served by the Worker as static assets |
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
