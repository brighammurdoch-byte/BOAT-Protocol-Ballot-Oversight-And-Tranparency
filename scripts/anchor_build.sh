#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
avm use 1.1.2
REPO="/mnt/c/Users/brigh/College/Personal_Projects/BOAT/BOAT-Protocol-Ballot-Oversight-And-Tranparency"
cd "$REPO"
# Keep deploy keypair; wipe build artifacts that confuse Anchor 1.x
if [ -f target/deploy/boat_final-keypair.json ]; then
  cp target/deploy/boat_final-keypair.json /tmp/boat_final-keypair.json
fi
rm -rf target/idl target/types target/sbpf* target/deploy/*.so .anchor/test-ledger
mkdir -p target/deploy
if [ -f /tmp/boat_final-keypair.json ]; then
  cp /tmp/boat_final-keypair.json target/deploy/boat_final-keypair.json
fi
# Remove stale IDL copies that lack discriminators
rm -f packages/boat-sdk/src/idl/boat_final.json app/boat-frontend/src/idl/boat_final.json
echo "Building..."
anchor build 2>&1
