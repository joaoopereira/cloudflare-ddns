#!/usr/bin/env bash
# Installs dependencies so tests and type checks work in fresh cloud sessions.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
if [ -f server/package-lock.json ] && [ ! -d server/node_modules ]; then
  (cd server && npm ci --no-audit --no-fund)
fi
if [ -f client/go.mod ] && command -v go >/dev/null 2>&1; then
  (cd client && go mod download)
fi
