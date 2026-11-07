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
3. Tag and push: `git tag client/vX.Y.Z && git push origin client/vX.Y.Z`
   (the release workflow from issue #16 builds linux/darwin/windows for
   amd64/arm64 plus `checksums.txt`).
4. Verify the release assets exist and the checksums match.
5. Rolling the fleet forward is a separate step: set the target version in the
   dashboard (one client first, then all).
