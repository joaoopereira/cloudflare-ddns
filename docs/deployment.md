# Deployment

One-time setup to run cloudflare-ddns on **ddns.apps.joaoopereira.com**. After
this, every push to `development` deploys automatically
([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)).

## 1. Create the D1 database

```bash
cd server
npx wrangler login
npx wrangler d1 create ddns
```

Copy the `database_id` it prints into `server/wrangler.toml`, replacing
`REPLACE_WITH_D1_DATABASE_ID`, and commit it. The id isn't a secret.

## 2. Give the Worker a Cloudflare API token

The Worker uses this token to update DNS records. Create it at
**Cloudflare dashboard → My Profile → API Tokens → Create Token** with:

- **Zone → Zone → Read**
- **Zone → DNS → Edit**
- Zone resources: the zones whose records you want to manage (or all zones)

Store it as a Worker secret:

```bash
npx wrangler secret put CF_API_TOKEN
```

## 3. Let GitHub Actions deploy

Create a second token for deployments (the **Edit Cloudflare Workers** template,
plus **Account → D1 → Edit**), then add these repository secrets under
**Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the deploy token |
| `CLOUDFLARE_ACCOUNT_ID` | your account id (shown on the Workers overview page) |

Until both secrets exist and the database id is filled in, the deploy workflow
skips with a warning instead of failing.

## 4. Custom domain

`wrangler.toml` already routes the Worker to `ddns.apps.joaoopereira.com` as a
[custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
The first deploy creates the DNS record and certificate for you; the
`joaoopereira.com` zone must be in the same Cloudflare account.

## 5. Protect the dashboard with Cloudflare Access

In **Zero Trust → Access → Applications → Add an application → Self-hosted**:

1. Application domain: `ddns.apps.joaoopereira.com`.
2. Add a policy that allows only you (for example *Emails* → your address).
3. Add **bypass** rules (or separate applications with a Bypass policy) for the
   public client paths so machines can reach them without logging in:
   `/api/client/*`, `/install.sh`, `/install.ps1`.

Then give the Worker the values it needs to verify Access logins itself, so
the admin API stays protected even if the Access configuration changes:

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN   # e.g. myteam.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD           # the application's "Application Audience (AUD) Tag"
```

Until both are set, `/api/admin/*` answers `503`.

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
