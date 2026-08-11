#!/usr/bin/env bash
set -euo pipefail
. "$HOME/.nvm/nvm.sh"
nvm use 22
REPO="/mnt/c/Users/brigh/College/Personal_Projects/BOAT/BOAT-Protocol-Ballot-Oversight-And-Tranparency"
cd "$REPO/apps/api"
SOLANA_RPC=https://api.devnet.solana.com npx tsx src/server.ts &
PID=$!
sleep 5
echo "=== health ==="
curl -s http://127.0.0.1:8787/health || true
echo
kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true
