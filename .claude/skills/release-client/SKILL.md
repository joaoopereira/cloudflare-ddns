---
name: release-client
description: Cut a new ddns-client release (version tag, cross-platform binaries, checksums) that installers and remote upgrades use. Use when asked to release or publish the client.
---

# Release the Go client

Releases are what `install.sh`/`install.ps1` download and what remote
upgrades point at, so a broken release breaks every machine that upgrades.

Flow: work lands on `development` (staging), reaches `main` (stable) by a
pull request, and releases are cut only from `main`. The workflow fails on
any other ref, and for a pushed tag that isn't on `main`.

1. Make sure `development` is green and the client checks pass
   (`cd client && go vet ./... && go test ./...`).
2. Pick the next semver version (`vMAJOR.MINOR.PATCH`, `npx git-cliff
   --bumped-version`). Ask the user before releasing: it publishes a release
   and deploys production.
3. Regenerate the changelog for the new version on `development` and push it:
   `npx git-cliff --tag vX.Y.Z -o CHANGELOG.md` then
   `git commit -m "chore(release): vX.Y.Z" CHANGELOG.md`.
4. Promote: open a PR from `development` to `main` (GitHub MCP
   `create_pull_request`, `base: main`, `head: development`, title
   `chore: promote development to main`). Once CI is green and the user
   merges it (merge commit, not squash/rebase), `main` holds the release.
5. Start the release on `main`. Cloud sessions can't push tags, so run the
   workflow manually: GitHub MCP `actions_run_trigger` with `run_workflow`,
   `workflow_id: release.yml`, `ref: main`, `inputs: {version: "vX.Y.Z"}`.
   It tags `main` itself. (From a local clone, `git tag vX.Y.Z && git push
   origin vX.Y.Z` on a commit that is on `main` also works.)
   `.github/workflows/release.yml` builds linux (amd64/arm64/arm),
   darwin (amd64/arm64) and windows (amd64/arm64) as
   `ddns-client_<os>_<arch>[.exe]`, writes `checksums.txt`, and publishes a
   GitHub Release with git-cliff notes. Asset names are a contract with
   `client/internal/upgrade` and the installers; don't rename them.
   Release notes for the tag: `npx git-cliff --latest --strip header`.
6. Verify the release assets exist and the checksums match.
7. The release workflow then deploys that tag of the Worker and dashboard
   to production (deploy.yml); check `/health` reports the new version.
8. Rolling the fleet forward is a separate step: set the target version in the
   dashboard (one client first, then all).
