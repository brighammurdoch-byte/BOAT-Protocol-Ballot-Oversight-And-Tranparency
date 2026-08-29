#!/usr/bin/env bash
set -euo pipefail
. "$HOME/.nvm/nvm.sh"
nvm use 22
REPO="/mnt/c/Users/brigh/College/Personal_Projects/BOAT/BOAT-Protocol-Ballot-Oversight-And-Tranparency"
cd "$REPO/apps/api"
export SOLANA_RPC=https://api.devnet.solana.com
# Capture startup with unbuffered output
npx tsx src/server.ts > /tmp/boat_api.log 2>&1 &
PID=$!
echo "started pid=$PID"
for i in $(seq 1 20); do
  if grep -q "listening" /tmp/boat_api.log 2>/dev/null; then
    echo "ready after ${i}s"
    break
  fi
  if ! kill -0 $PID 2>/dev/null; then
    echo "process died"
    cat /tmp/boat_api.log
    exit 1
  fi
  sleep 1
done
cat /tmp/boat_api.log
echo "---"
curl -s http://127.0.0.1:8787/health; echo
curl -s "http://127.0.0.1:8787/elections/9qXjWU8WoPvbjSx3bsrNuaEJHeozbzqEvpA82TgghRNA/tally"; echo
kill $PID 2>/dev/null || true
