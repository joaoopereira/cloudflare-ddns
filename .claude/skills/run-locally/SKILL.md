---
name: run-locally
description: Run the cloudflare-ddns Worker locally with a local D1 database and exercise its endpoints (and the Go client) by hand. Use to see a server change working end to end.
---

# Run cloudflare-ddns locally

1. Install and migrate (first time, or after adding a migration):
   ```bash
   cd server
   npm ci
   npm run db:migrate:local
   ```
2. Local secrets go in `server/.dev.vars` (gitignored), e.g.
   `CF_API_TOKEN=...`. Without a token, DNS calls must be skipped or mocked;
   never use a production token for experiments unless the user asks.
3. Start the Worker in the background: `npm run dev` (serves http://localhost:8787).
4. Smoke test:
   ```bash
   curl -s localhost:8787/health
   ```
   Locally `CF-Connecting-IP` is not set; pass it explicitly to simulate a
   client's public IP: `curl -H 'CF-Connecting-IP: 203.0.113.7' ...`.
5. Inspect or tweak the local database:
   ```bash
   npx wrangler d1 execute ddns --local --command "SELECT * FROM clients"
   npx wrangler d1 execute ddns --local --command "UPDATE settings SET value='true' WHERE key='registration_open'"
   ```
6. Run the Go client against it:
   `cd client && go run ./cmd/ddns-client --server http://localhost:8787 --config /tmp/ddns.json`.
   To test installers and upgrades, put a release in the local R2 bucket:
   ```bash
   go build -ldflags "-X main.version=v0.0.1" -o /tmp/rel/ddns-client_linux_amd64 ./cmd/ddns-client
   (cd /tmp/rel && sha256sum ddns-client_* > checksums.txt && echo v0.0.1 > latest.txt)
   cd ../server
   for f in ddns-client_linux_amd64 checksums.txt; do npx wrangler r2 object put ddns-releases/v0.0.1/$f --file /tmp/rel/$f --local; done
   npx wrangler r2 object put ddns-releases/latest.txt --file /tmp/rel/latest.txt --local
   curl -fsSL localhost:8787/install.sh | DDNS_SERVER=http://localhost:8787 DDNS_NO_SERVICE=1 sh
   ```
   Then `POST /api/admin/clients/<id>/upgrade {"version":"v0.0.2"}` after
   uploading a v0.0.2 the same way; the client exits with code 75 after
   replacing itself.
7. Stop the dev server when done. Reset local state with `rm -rf server/.wrangler`.
