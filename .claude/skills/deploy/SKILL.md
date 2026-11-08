---
name: deploy
description: Deploy or check the deployment of the cloudflare-ddns Worker at ddns.apps.joaoopereira.com. Use when asked to deploy, verify production, or debug a failed deploy workflow.
---

# Deploy cloudflare-ddns

Production only ever runs a released version. The Release workflow
(`.github/workflows/release.yml`) tags, publishes the client and then calls
`.github/workflows/deploy.yml` for that tag (migrations first, then
`wrangler deploy`). Pushes to `development` don't deploy. To redeploy an
existing release, run the Deploy workflow with `version: vX.Y.Z` (GitHub MCP
`actions_run_trigger`, `workflow_id: deploy.yml`). Never deploy unreleased
code, and only deploy or release when the user asks.

1. Prerequisites (docs/deployment.md): GitHub repo secrets
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (deploy), plus
   `DNS_API_TOKEN`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, which the workflow
   copies into Worker secrets on each deploy. Never set Worker secrets by
   hand; change the GitHub secret and redeploy. If the workflow logs
   "skipping", one of these is missing.
2. Before deploying: checks from CLAUDE.md pass, and
   `cd server && npx wrangler deploy --dry-run --outdir dist` succeeds.
3. Manual deploy (needs Cloudflare credentials in the environment):
   `npm run db:migrate:remote && npm run deploy`.
4. Verify: `curl -s https://ddns.apps.joaoopereira.com/health` returns
   `{"ok":true,"db":true}`. Tail logs with `npx wrangler tail`.
5. Rollback: `npx wrangler rollback` restores the previous Worker version.
   D1 migrations do not roll back; fix forward with a new migration.
