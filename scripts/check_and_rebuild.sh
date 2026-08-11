#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
avm use 1.1.2
REPO="/mnt/c/Users/brigh/College/Personal_Projects/BOAT/BOAT-Protocol-Ballot-Oversight-And-Tranparency"
cd "$REPO"
echo "== deploy =="
ls -la target/deploy || true
echo "== idl =="
ls -la target/idl || true
echo "== types =="
ls -la target/types || true
echo "== so =="
find target -name '*.so' 2>/dev/null || true
echo "== json idl =="
find target -name 'boat_final.json' 2>/dev/null || true
echo "== rebuild verbose =="
anchor build -v 2>&1 | tee /tmp/anchor_build_out.txt | tail -80
