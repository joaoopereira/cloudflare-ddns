# Deployment

cloudflare-ddns runs in your own Cloudflare account. There are two ways to
put it there:

- **[The Deploy to Cloudflare button](#option-a-the-deploy-to-cloudflare-button)**:
  a few clicks, nothing to install. Best for most people.
- **[GitHub Actions in a fork](#option-b-github-actions-in-a-fork)**: every
  release you cut deploys itself, on a custom domain from the start. Best if
  you want to change the code.

In this guide `ddns.example.com` stands for the address of your deployment.

## Option A: the Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/joaoopereira/cloudflare-ddns)

1. Click the button and sign in to Cloudflare. It copies this repository to
   your GitHub or GitLab account, creates the D1 database and the R2 bucket,
   and asks for three secrets:
   - `CF_API_TOKEN`: create a [custom API token](https://dash.cloudflare.com/profile/api-tokens)
     with **Zone → Zone → Read** and **Zone → DNS → Edit** on every zone
     whose records your machines should manage.
   - `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`: you get these in step 3; enter
     `todo` for now. Until they are right the dashboard shows nothing and
     `/api/admin/*` refuses every request.
2. Deploy. The app comes up at `https://cloudflare-ddns.<your-subdomain>.workers.dev`;
   `/health` there should answer `{"ok":true,"db":true,...}`.
3. Protect the dashboard with Cloudflare Access, following
   [Cloudflare Access for the dashboard](#3-cloudflare-access-for-the-dashboard)
   below with your app's address as the application domain. Then put the
   team domain and AUD tag in the Worker's **Settings → Variables and
   Secrets** (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`).
4. Optional: add your own hostname under the Worker's **Settings → Domains &
   Routes → Add → Custom domain**, and use it in the Access applications.
   Machines keep talking to the address they were installed from, so pick the
   address before you install clients.
5. Open the dashboard, click **Listen for new clients** and install your first
   machine ([user guide](user-guide.md)).

There is nothing to release: client binaries are fetched from this project's
[GitHub Releases](https://github.com/joaoopereira/cloudflare-ddns/releases)
into your R2 bucket the first time they are needed (the `RELEASES_REPO`
variable), and machines download them from your Worker. To update the app
later, sync your copy of the repository with this one; Cloudflare redeploys
it on every push. The dashboard footer shows `dev` as the app version on
deployments made this way.

## Option B: GitHub Actions in a fork

One-time setup in a fork of this repository; the zone of your hostname
(`example.com`) must be in your Cloudflare account. After
this, every release deploys automatically: production only ever runs a
released version, never unreleased commits
([`.github/workflows/release.yml`](../.github/workflows/release.yml) calls
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)). An
optional [staging deployment](#7-optional-staging) runs every push to
`development`.

Branches: `development` is staging, where work lands. `main` is stable: it
only moves by a promotion pull request from `development`, and releases are
cut only from `main` (see [Promote and release](#promote-and-release)).

### 1. D1 database and R2 bucket

Create both once in your Cloudflare account:

```bash
npx wrangler d1 create ddns                 # note the database_id it prints
npx wrangler r2 bucket create ddns-releases
```

### 2. Create two Cloudflare API tokens

At **Cloudflare dashboard → My Profile → API Tokens → Create Token → Create
Custom Token**:

1. **Deploy token** (used only by GitHub Actions):
   - Account → **Workers Scripts** → Edit
   - Account → **D1** → Edit
   - Account → **Workers R2 Storage** → Edit
   - Zone → **Workers Routes** → Edit, and Zone → **DNS** → Edit (for the custom domain)
   - Zone → **Zone** → Read
   - Zone resources: `example.com`
2. **DNS token** (used by the Worker at runtime to update client records):
   - Zone → **Zone** → Read
   - Zone → **DNS** → Edit
   - Zone resources: every zone whose records clients should manage (or all zones)

Keeping them separate means the running Worker can only edit DNS, not deploy code.

### 3. Cloudflare Access for the dashboard

In **Zero Trust → Access → Applications → Add an application → Self-hosted**:

1. Application domain: `ddns.example.com`.
2. Add a policy that allows only you (for example *Emails* → your address).
3. Add bypass coverage for the public client paths so machines can reach
   them without logging in: create a second self-hosted application for
   `ddns.example.com` with these paths and a **Bypass** policy
   (Include → Everyone): `/api/client/*`, `/download/*`, `/install.sh`,
   `/install.ps1`, `/health`.
4. Copy the first application's **Application Audience (AUD) Tag** and your
   team domain (**Zero Trust → Settings → Custom pages**, e.g.
   `myteam.cloudflareaccess.com`).
5. Set how long a login lasts. The dashboard has no session of its own: you
   stay signed in for as long as the Access cookie is valid (24 hours by
   default). Raise the first application's **Session Duration** (for
   example to 1 month), keep the policy's own **Session Duration** on
   *Same as application session timeout*, and set the team-wide **global
   session duration** (**Zero Trust → Access controls → Access settings →
   Set your global session duration**) to match: when the app
   session ends, Access only signs you back in silently while the global
   session is still valid.

The dashboard can be installed as an app (see the user guide). Its manifest
and icons (`/manifest.webmanifest`, `/icons/*`) and service worker (`/sw.js`)
stay behind Access; the page fetches the manifest with credentials, so no
bypass is needed. If a browser still doesn't offer to install it, add
`/manifest.webmanifest` and `/icons/*` to the bypass application (they hold
nothing private).

The Worker verifies the Access login itself on `/api/admin/*`, so the admin
API stays protected even if the Access configuration changes. Until the AUD
and team domain are set, `/api/admin/*` answers `503`.

### 4. Add GitHub repository secrets and variables

Under **GitHub → repository → Settings → Secrets and variables → Actions →
New repository secret**:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the deploy token |
| `CLOUDFLARE_ACCOUNT_ID` | your account id (Workers & Pages overview, right sidebar) |
| `DNS_API_TOKEN` | the DNS token |
| `ACCESS_TEAM_DOMAIN` | e.g. `myteam.cloudflareaccess.com` |
| `ACCESS_AUD` | the Access application's AUD tag |

On the **Variables** tab of the same page, add (they are not secret):

| Variable | Value |
| --- | --- |
| `DDNS_HOSTNAME` | the hostname of the app, e.g. `ddns.example.com` |
| `D1_DATABASE_ID` | the `database_id` printed in step 1 |

The deploy workflow writes these two into `wrangler.toml` (the custom
domain, with the workers.dev address turned off, and the D1 id) and fails
with a clear error if either is missing.

When a release is cut (Actions → Release client → Run workflow on `main` with
a version like `v1.2.0`), the release workflow tags `main`, publishes the client
binaries and then runs the deploy workflow for that tag: it applies D1
migrations, builds the dashboard, deploys the Worker, and copies the last
three secrets into Worker secrets (`CF_API_TOKEN`, `ACCESS_TEAM_DOMAIN`,
`ACCESS_AUD`). Until the first two exist it skips with a warning. To redeploy
an existing release (for example after changing a secret), run the **Deploy**
workflow manually (Actions → Deploy → Run workflow) with its tag; it only
accepts release tags.

The first deploy creates the DNS record and certificate of the custom domain.

### 5. Publish the first client release

Installers download the latest release from the Worker, so publish one before
installing any machine:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Run this on `main` (the tagged commit must be on `main`, or the workflow
fails). Or, without a local clone: **Actions → Release client → Run
workflow**, pick `main` and enter the version (for example `v0.1.0`); the
workflow creates the tag itself. Other branches are refused.

`.github/workflows/release.yml` builds every platform, uploads the files to
R2 and creates a GitHub Release.

### 6. Check it

- `https://ddns.example.com/health` returns `{"ok":true,"db":true,"version":"v1.0.0","commit":"abc1234"}`.
  The deploy workflow sets `version` (the release tag) and `commit` (short
  SHA) as the Worker vars `APP_VERSION` and `APP_COMMIT`, and builds the
  dashboard with the same values.
- Opening `https://ddns.example.com` asks you to sign in, then shows the dashboard.
- Click **Listen for new clients**, run the one-liner on a machine, approve it.

### 7. Optional: staging

Every push to `development` that passes CI deploys to a separate `staging`
Worker (`cloudflare-ddns-staging`) with its own D1 database and hostname, for
example `ddns-staging.example.com`. Until it is set up, CI logs a warning
and skips the deploy. To set it up:

1. Create the staging database: `npx wrangler d1 create ddns-staging`.
2. Add the staging hostname to both Access applications from step 3 (an
   application can cover several domains, so the AUD and team domain stay
   the same).
3. Add the repository variables `STAGING_HOSTNAME` (e.g.
   `ddns-staging.example.com`) and `STAGING_D1_DATABASE_ID` (the id from
   step 1).

Staging uses the same secrets and R2 bucket as production. It has its own
clients, so it only touches the DNS records of machines approved in the
staging dashboard; point those at test records. The dashboard footer shows
the staging build as `git describe` output, like `v1.3.0-4-gabc1234`.

## Promote and release

1. Work lands on `development`; CI runs and deploys it to staging.
2. Promote to stable by opening a pull request from `development` to `main`:
   `https://github.com/<owner>/cloudflare-ddns/compare/main...development`,
   or `gh pr create --base main --head development --title "chore: promote development to main"`.
   CI runs on the pull request. Merge it with **Create a merge commit** (not
   squash or rebase, which rewrite the commits and make the branches
   diverge).
3. The Sync development workflow then merges `main` back into `development`,
   so release tags cut on `main` stay reachable from `development` (git-cliff
   needs them).
4. Release from `main` (step 5 above). That deploys the release to
   production.

## Local development

Create `.dev.vars` at the repository root (gitignored):

```
CF_API_TOKEN=<a token for a test zone>
ALLOW_INSECURE_ADMIN=true
```

`ALLOW_INSECURE_ADMIN` skips the Access check. Never set it in production.

## Manual deploy

Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.toml` with your database
id (don't commit it), then:

```bash
cd server
npm run db:migrate:remote
npm run deploy
```
