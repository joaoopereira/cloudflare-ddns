---
name: implement-issue
description: Implement a cloudflare-ddns backlog issue end to end (read issue, code, tests, docs, push to development). Use when asked to work on a GitHub issue or the next backlog item.
---

# Implement a backlog issue

1. Read the issue and its parent epic (GitHub MCP `issue_read`). Check
   CLAUDE.md "Key decisions"; if the issue conflicts with them, ask first.
2. Work on `development` directly (no PRs, per the repo owner). Pull first:
   `git pull origin development`.
3. Implement in the right area:
   - Worker routes go in `server/src/routes/` and are mounted in
     `server/src/index.ts`. Client endpoints under `/api/client/*`, dashboard
     endpoints under `/api/admin/*` (validate the Access JWT).
   - Schema changes: follow the add-d1-migration skill.
   - Go client code under `client/internal/...`, entrypoint `client/cmd/ddns-client`.
4. Tests: vitest for the Worker (use the in-memory D1 pattern in
   `server/test/health.test.ts`; mock `fetch` for Cloudflare API calls), `go
   test` for the client. Cover the security rules: pending/rejected clients
   must never change DNS, blocked IPs and closed registration are rejected.
5. Run the checks listed in CLAUDE.md.
6. If users would notice the change, update docs/user-guide.md (remove
   "(planned)" for shipped features) and README status.
7. Commit with `Closes #N` in the message and push to `development`. That
   triggers CI and the production deploy, so the checks must pass first.
