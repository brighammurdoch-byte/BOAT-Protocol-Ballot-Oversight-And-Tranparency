#!/usr/bin/env bash
set -euo pipefail
REPO="/mnt/c/Users/brigh/College/Personal_Projects/BOAT/BOAT-Protocol-Ballot-Oversight-And-Tranparency"
mkdir -p "$REPO/docs/archive"
if [ -f "$REPO/DEPENDENCY_RESOLUTION_SUMMARY.md" ]; then
  mv "$REPO/DEPENDENCY_RESOLUTION_SUMMARY.md" "$REPO/docs/archive/DEPENDENCY_RESOLUTION_SUMMARY.md"
fi
HEADER='> **Historical (March 2026).** Applies only to the archived Anchor 0.29 program. The live program uses Anchor 1.1.2 with a thin Cargo.toml — do not re-apply these pins.

'
if [ -f "$REPO/docs/archive/DEPENDENCY_RESOLUTION_SUMMARY.md" ]; then
  { printf "%s" "$HEADER"; cat "$REPO/docs/archive/DEPENDENCY_RESOLUTION_SUMMARY.md"; } > /tmp/dep.md
  mv /tmp/dep.md "$REPO/docs/archive/DEPENDENCY_RESOLUTION_SUMMARY.md"
fi
# Retire stable dockerfile
if [ -f "$REPO/Dockerfile.stable" ]; then
  mv "$REPO/Dockerfile.stable" "$REPO/docs/archive/Dockerfile.stable.0.29"
fi
if [ -f "$REPO/docker-compose.stable.yml" ]; then
  mv "$REPO/docker-compose.stable.yml" "$REPO/docs/archive/docker-compose.stable.0.29.yml"
fi
echo done
