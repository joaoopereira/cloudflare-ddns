# Deployment

One-time setup to run cloudflare-ddns on **ddns.apps.joaoopereira.com**. After
this, every release deploys automatically: production only ever runs a
released version, never unreleased commits from `development`
([`.github/workflows/release.yml`](../.github/workflows/release.yml) calls
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)).

## 1. D1 database and R2 bucket (done)

Both already exist in the Cloudflare account: the D1 database `ddns` (its id
is in `server/wrangler.toml`) and the R2 bucket `ddns-releases`. To recreate
them elsewhere: `npx wrangler d1 create ddns` (then update `database_id`) and
`npx wrangler r2 bucket create ddns-releases`.

## 2. Create two Cloudflare API tokens

At **Cloudflare dashboard → My Profile → API Tokens → Create Token → Create
Custom Token**:

1. **Deploy token** (used only by GitHub Actions):
   - Account → **Workers Scripts** → Edit
   - Account → **D1** → Edit
   - Account → **Workers R2 Storage** → Edit
   - Zone → **Workers Routes** → Edit, and Zone → **DNS** → Edit (for the custom domain)
   - Zone → **Zone** → Read
   - Zone resources: `joaoopereira.com`
2. **DNS token** (used by the Worker at runtime to update client records):
   - Zone → **Zone** → Read
   - Zone → **DNS** → Edit
   - Zone resources: every zone whose records clients should manage (or all zones)

Keeping them separate means the running Worker can only edit DNS, not deploy code.

## 3. Cloudflare Access for the dashboard

In **Zero Trust → Access → Applications → Add an application → Self-hosted**:

1. Application domain: `ddns.apps.joaoopereira.com`.
2. Add a policy that allows only you (for example *Emails* → your address).
3. Add bypass coverage for the public client paths so machines can reach
   them without logging in: create a second self-hosted application for
   `ddns.apps.joaoopereira.com` with these paths and a **Bypass** policy
   (Include → Everyone): `/api/client/*`, `/download/*`, `/install.sh`,
   `/install.ps1`, `/health`.
4. Copy the first application's **Application Audience (AUD) Tag** and your
   team domain (**Zero Trust → Settings → Custom pages**, e.g.
   `myteam.cloudflareaccess.com`).

The dashboard can be installed as an app (see the user guide). Its manifest
and icons (`/manifest.webmanifest`, `/icons/*`) and service worker (`/sw.js`)
stay behind Access; the page fetches the manifest with credentials, so no
bypass is needed. If a browser still doesn't offer to install it, add
`/manifest.webmanifest` and `/icons/*` to the bypass application (they hold
nothing private).

The Worker verifies the Access login itself on `/api/admin/*`, so the admin
API stays protected even if the Access configuration changes. Until the AUD
and team domain are set, `/api/admin/*` answers `503`.

## 4. Add GitHub repository secrets

Under **GitHub → repository → Settings → Secrets and variables → Actions →
New repository secret**:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the deploy token |
| `CLOUDFLARE_ACCOUNT_ID` | your account id (Workers & Pages overview, right sidebar) |
| `DNS_API_TOKEN` | the DNS token |
| `ACCESS_TEAM_DOMAIN` | e.g. `myteam.cloudflareaccess.com` |
| `ACCESS_AUD` | the Access application's AUD tag |

When a release is cut (Actions → Release client → Run workflow with a version
like `v1.2.0`), the release workflow tags `development`, publishes the client
binaries and then runs the deploy workflow for that tag: it applies D1
migrations, builds the dashboard, deploys the Worker, and copies the last
three secrets into Worker secrets (`CF_API_TOKEN`, `ACCESS_TEAM_DOMAIN`,
`ACCESS_AUD`). Until the first two exist it skips with a warning. To redeploy
an existing release (for example after changing a secret), run the **Deploy**
workflow manually (Actions → Deploy → Run workflow) with its tag; it only
accepts release tags.

The custom domain `ddns.apps.joaoopereira.com` is set in `wrangler.toml`; the
first deploy creates its DNS record and certificate.

## 5. Publish the first client release

Installers download the latest release from the Worker, so publish one before
installing any machine:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Or, without a local clone: **Actions → Release client → Run workflow**, pick
`development` and enter the version (for example `v0.1.0`); the workflow
creates the tag itself.

`.github/workflows/release.yml` builds every platform, uploads the files to
R2 and creates a GitHub Release.

## 6. Check it

- `https://ddns.apps.joaoopereira.com/health` returns `{"ok":true,"db":true,"version":"v1.0.0","commit":"abc1234"}`.
  The deploy workflow sets `version` (the release tag) and `commit` (short
  SHA) as the Worker vars `APP_VERSION` and `APP_COMMIT`, and builds the
  dashboard with the same values.
- Opening `https://ddns.apps.joaoopereira.com` asks you to sign in, then shows the dashboard.
- Click **Listen for new clients**, run the one-liner on a machine, approve it.

## Local development

Create `server/.dev.vars` (gitignored):

```
CF_API_TOKEN=<a token for a test zone>
ALLOW_INSECURE_ADMIN=true
```

`ALLOW_INSECURE_ADMIN` skips the Access check. Never set it in production.

## Manual deploy

```bash
cd server
npm run db:migrate:remote
npm run deploy
```
