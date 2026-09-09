#!/usr/bin/env bash
set -euo pipefail

echo "Running the local @adaptive-ds/telegram-send deployment preflight."
bun run format:check
bun run type-check
bun run test
bun run build
