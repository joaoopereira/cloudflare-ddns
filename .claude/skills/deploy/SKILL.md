---
name: deploy
description: Deploy or check the deployment of the cloudflare-ddns Worker at ddns.apps.joaoopereira.com. Use when asked to deploy, verify production, or debug a failed deploy workflow.
---

# Deploy cloudflare-ddns

Production deploys happen automatically on merge to `development` via
`.github/workflows/deploy.yml` (migrations first, then `wrangler deploy`).
Deploying is a production change: only do it manually when the user asks.

1. Prerequisites (docs/deployment.md): real `database_id` in
   `server/wrangler.toml`, `CF_API_TOKEN` Worker secret, repo secrets
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. If the workflow logs
   "skipping deploy", one of these is missing.
2. Before deploying: checks from CLAUDE.md pass, and
   `cd server && npx wrangler deploy --dry-run --outdir dist` succeeds.
3. Manual deploy (needs Cloudflare credentials in the environment):
   `npm run db:migrate:remote && npm run deploy`.
4. Verify: `curl -s https://ddns.apps.joaoopereira.com/health` returns
   `{"ok":true,"db":true}`. Tail logs with `npx wrangler tail`.
5. Rollback: `npx wrangler rollback` restores the previous Worker version.
   D1 migrations do not roll back; fix forward with a new migration.
