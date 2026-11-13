# HTTP API

All endpoints take and return JSON. Base URL: `https://ddns.example.com`.

## Client API (`/api/client/*`)

Used by `ddns-client`. Public (bypassed in Cloudflare Access) and IPv4-only:
the server takes the client's public IP from the connection
(`CF-Connecting-IP`), never from the request body. Requests from an IPv6
address get `400`.

Clients authenticate with credentials they generate on first run:

| Field | Rules |
| --- | --- |
| `id` | 8–64 chars, `[A-Za-z0-9_-]` (a UUID works) |
| `secret` | 32–256 chars, random; the server stores only its SHA-256 |

### `POST /api/client/register`

```json
{ "id": "…", "secret": "…", "hostname": "nas", "os": "linux", "arch": "arm64", "version": "v0.1.0" }
```

| Status | Body | Meaning / what the client does |
| --- | --- | --- |
| `201` | `{"status":"pending","interval":60}` | Registered (or re-registered after an unblock). Start heartbeating. |
| `200` | `{"status":"pending" \| "approved" \| "revoked","interval":60}` | Already registered with these credentials. |
| `403` | `{"status":"closed"}` | *Listen for new clients* is off. Retry later with backoff. |
| `403` | `{"status":"blocked"}` | This IP is blocked. Retry later with backoff (it may get unblocked). |
| `429` | `{"status":"rate_limited"}` | Too many registrations from this IP. Back off. |
| `401` | | The id exists with a different secret. |
| `400` | | Invalid id/secret, or not IPv4. |

### `POST /api/client/heartbeat`

Send every `interval` seconds.

```json
{ "id": "…", "secret": "…", "version": "v0.1.0", "error": "optional: last local error, e.g. a failed upgrade" }
```

| Status | Body | Meaning |
| --- | --- | --- |
| `200` | `{"status":"pending","interval":60,"ip":"203.0.113.7"}` | Waiting for approval. Nothing is written to DNS. |
| `200` | `{"status":"approved","interval":60,"ip":"…","dns":"updated" \| "error","target_version":"v0.2.0"}` | `dns` appears only when the server tried to change the record. `target_version` appears when the client should upgrade. |
| `403` | `{"status":"rejected" \| "revoked"}` | Stop heartbeating. Rejected clients go back to registering with backoff. |
| `404` | `{"status":"unknown"}` | The server doesn't know this client (deleted). Register again. |
| `401` | | Wrong secret. |

The client should use `interval` from each response as its next delay.

## Downloads and installers (public)

| Path | Purpose |
| --- | --- |
| `GET /health` | `{"ok":true,"db":true,"version":"v1.1.0","commit":"abc1234"}`. `version` is the deployed release tag (`dev` when not set by the deploy workflow), `commit` the short commit SHA or `null`. |
| `GET /install.sh`, `GET /install.ps1` | Installers, with this server's URL filled in |
| `GET /download/<version>/<asset>` | Client binaries from the `ddns-releases` R2 bucket. `version` is `vX.Y.Z` or `latest`; the response's `X-Release-Version` header names the resolved version. Assets: `ddns-client_<os>_<arch>[.exe]` (os: linux, darwin, windows; arch: amd64, arm64, arm) and `checksums.txt`. |

## Admin API (`/api/admin/*`)

Used by the dashboard. Requires a Cloudflare Access session (the Worker
verifies the `Cf-Access-Jwt-Assertion` header against `ACCESS_TEAM_DOMAIN` and
`ACCESS_AUD`).

| Method and path | Purpose |
| --- | --- |
| `GET /me` | Signed-in admin email |
| `GET /clients` | All clients with `name` (friendly name or `null`), `online`, `approval_deadline`, `effective_target_version` |
| `GET /clients/:id` | One client |
| `POST /clients/:id/approve` | `{"zone_id","record_name","name"?}`. Approve a pending client, or change an approved client's record. `record_name` can be `home`, `home.example.com` or `@`. `name` is optional (see `PATCH`); leave it out to keep the current one. `409` if another client uses the record. |
| `PATCH /clients/:id` | `{"name":"Home NAS"}` sets the client's friendly name, `{"name":null}` (or a blank string) clears it. Names are trimmed, at most 64 characters, no control characters. Returns `{"client"}`. Clients can't set their own name. |
| `POST /clients/:id/reject` | Reject a pending client and block its IP |
| `POST /clients/:id/revoke` | Stop a client from updating DNS |
| `DELETE /clients/:id[?delete_record=true]` | Remove a client, optionally its DNS record |
| `POST /clients/:id/upgrade` | `{"version":"v1.2.3"}` to upgrade this client, `{"version":null}` to clear it |
| `GET /zones` | Zones the Worker's token can see |
| `GET /releases/latest` | `{"version":"v1.2.3"}`, the newest published client release |
| `GET /settings`, `PUT /settings` | `registration_open` (bool), `approval_timeout_seconds` (30–86400), `heartbeat_interval_seconds` (15–3600), `target_client_version` (semver or `""`) |
| `GET /blocked-ips`, `DELETE /blocked-ips/:ip` | List and unblock IPs |
| `GET /events[?client_id=&limit=]` | Audit log, newest first |
