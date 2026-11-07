# User guide

This guide covers day-to-day use of cloudflare-ddns: adding machines, choosing
their DNS records, and keeping them up to date.

> Features are being built in stages. Sections marked **(planned)** describe
> how the feature will work once it ships; check the
> [backlog](https://github.com/joaoopereira/cloudflare-ddns/issues) for status.

## Concepts

- **Client:** a machine running `ddns-client`. Each client owns exactly one
  DNS **A record** (IPv4), for example `home.example.com`.
- **Pending client:** a machine that has registered but that you haven't
  approved yet. It can't change any DNS.
- **Online / offline:** a client is online if its last heartbeat (sent every
  60 seconds) arrived within the last ~3 minutes.
- **Blocked IP:** a public IP that isn't allowed to register new clients,
  usually because a pending client from it wasn't approved in time.

## Signing in

Open **https://ddns.apps.joaoopereira.com**. Cloudflare Access asks you to sign
in (with the method configured for the app, such as a one-time code by email).
Only people allowed by the Access policy can open the dashboard.

## Adding a machine

1. In the dashboard, turn on **Listen for new clients**. While it's off, new
   machines can't register at all.
2. On the machine, run the one-liner for its OS. No questions are asked.

   **Linux / macOS** (as root or with sudo):

   ```bash
   curl -fsSL https://ddns.apps.joaoopereira.com/install.sh | sudo sh
   ```

   **Windows** (PowerShell, *Run as Administrator*):

   ```powershell
   irm https://ddns.apps.joaoopereira.com/install.ps1 | iex
   ```

   The client is installed as a service (systemd on Linux, launchd on macOS,
   a Windows service on Windows) and starts immediately. Running the
   one-liner again repairs the install and updates it to the latest release.

   > Until the dashboard ships, use the admin API to approve
   > (`POST /api/admin/clients/:id/approve`, see [API reference](api.md)).
3. Within a few seconds the machine appears under **Pending clients** with its
   public IP, hostname and OS.
4. Click **Approve**, pick the **zone** (domain) and type the **record name**
   (for example `home` for `home.example.com`). Save.
5. Turn **Listen for new clients** off again when you're done.

From now on the record follows the machine's public IP. If the record doesn't
exist yet, it's created on the first heartbeat after approval.

### If you don't approve in time

A pending client must be approved within the **approval timeout** (5 minutes by
default; change it in **Settings**). Otherwise it's rejected and its public IP
is added to **Blocked IPs**. The client keeps retrying quietly in the
background.

Note that blocking is per public IP: other machines behind the same router are
blocked from registering too.

## The clients list (planned)

For each client you see the hostname, its record, the current IP, online or
offline, when the IP was last updated, when the client was last seen, its OS
and the client version.

## Changing or removing a client (planned)

- **Edit:** change the zone or record name of an approved client.
- **Revoke:** the client can no longer update DNS. The record is left as is.
- **Delete:** removes the client, optionally deleting its DNS record too.

To remove the software from a machine, run the installer with `uninstall`
(this also deletes the machine's identity, so a reinstall registers as a new
client):

```bash
curl -fsSL https://ddns.apps.joaoopereira.com/install.sh | sudo sh -s -- uninstall
```

```powershell
& ([scriptblock]::Create((irm https://ddns.apps.joaoopereira.com/install.ps1))) uninstall
```

## Blocked IPs (planned)

**Blocked IPs** lists every blocked address, why it was blocked and when.
Click **Unblock** to allow it again. A client behind that IP reappears under
**Pending clients** on its next retry (within a few minutes), as long as
**Listen for new clients** is on.

## Upgrading clients (planned)

The dashboard shows the latest released client version and the version each
machine runs. Choose **Upgrade** on one client, or **Upgrade all**. Clients pick
it up on their next heartbeat, verify the download, replace themselves and
restart. If an upgrade fails, the error is shown on the client's row.

## Settings (planned)

| Setting | Default | Meaning |
| --- | --- | --- |
| Approval timeout | 5 minutes | How long a pending client waits for approval before it's rejected and its IP blocked |

## Troubleshooting

- **The machine never shows up as pending.** Check that *Listen for new
  clients* is on and that its IP isn't under *Blocked IPs*. On the machine,
  check the service logs: `journalctl -u ddns-client -f` (Linux),
  `tail -f /var/log/ddns-client.log` (macOS), or Event Viewer → Windows
  Logs → Application (Windows).
- **A client shows offline.** The machine is off, has no internet, or the
  service stopped. Restart the service and it reconnects on its own.
- **The record has the wrong IP.** The Worker uses the IP the heartbeat comes
  from. If the machine sends traffic through a VPN or proxy, that address is
  what gets published.
