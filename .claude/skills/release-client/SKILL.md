---
name: release-client
description: Cut a new ddns-client release (version tag, cross-platform binaries, checksums) that installers and remote upgrades use. Use when asked to release or publish the client.
---

# Release the Go client

Releases are what `install.sh`/`install.ps1` download and what remote
upgrades point at, so a broken release breaks every machine that upgrades.

1. Make sure `development` is green and the client checks pass
   (`cd client && go vet ./... && go test ./...`).
2. Pick the next semver version (`vMAJOR.MINOR.PATCH`). Ask the user before
   tagging: pushing a tag publishes a release.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
   `.github/workflows/release.yml` builds linux (amd64/arm64/arm),
   darwin (amd64/arm64) and windows (amd64/arm64) as
   `ddns-client_<os>_<arch>[.exe]`, writes `checksums.txt`, and publishes a
   GitHub Release with git-cliff notes. Asset names are a contract with
   `client/internal/upgrade` and the installers; don't rename them.
   Before tagging, regenerate the changelog for the new version and commit it:
   `npx git-cliff --tag vX.Y.Z -o CHANGELOG.md` then
   `git commit -m "chore(release): vX.Y.Z" CHANGELOG.md`.
   Release notes for the tag: `npx git-cliff --latest --strip header`.
4. Verify the release assets exist and the checksums match.
5. Rolling the fleet forward is a separate step: set the target version in the
   dashboard (one client first, then all).
