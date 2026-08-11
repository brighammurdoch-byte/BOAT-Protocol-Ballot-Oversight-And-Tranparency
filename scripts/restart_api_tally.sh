#!/usr/bin/env bash
set -euo pipefail
. "$HOME/.nvm/nvm.sh"
nvm use 22
REPO="/mnt/c/Users/brigh/College/Personal_Projects/BOAT/BOAT-Protocol-Ballot-Oversight-And-Tranparency"
cd "$REPO/apps/api"
echo "starting..."
SOLANA_RPC=https://api.devnet.solana.com npx tsx src/server.ts > /tmp/boat_api.log 2>&1 &
PID=$!
echo "pid $PID"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf http://127.0.0.1:8787/health >/dev/null; then
    break
  fi
  sleep 1
done
echo "=== health ==="
curl -s http://127.0.0.1:8787/health || true
echo
echo "=== tally ==="
curl -s "http://127.0.0.1:8787/elections/9qXjWU8WoPvbjSx3bsrNuaEJHeozbzqEvpA82TgghRNA/tally" || true
echo
echo "=== log ==="
cat /tmp/boat_api.log
kill $PID 2>/dev/null || true
