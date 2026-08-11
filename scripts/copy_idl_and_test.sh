#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
avm use 1.1.2
REPO="/mnt/c/Users/brigh/College/Personal_Projects/BOAT/BOAT-Protocol-Ballot-Oversight-And-Tranparency"
cd "$REPO"
anchor build --help 2>&1 | head -80
echo "----"
# Prefer local toolchain; avoid docker-in-wsl requirement
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
# Copy IDL into SDK + frontend
mkdir -p packages/boat-sdk/src/idl app/boat-frontend/src/idl
cp target/idl/boat_final.json packages/boat-sdk/src/idl/boat_final.json
cp target/idl/boat_final.json app/boat-frontend/src/idl/boat_final.json
echo "IDL address:"; python3 -c "import json; print(json.load(open('target/idl/boat_final.json'))['address'])"
# Install JS deps and run tests (reuse existing .so)
if [ ! -d node_modules ]; then
  yarn install
fi
# Check whether @coral-xyz/anchor 0.31 works with IDL 1.x; may need newer package
anchor test --skip-build 2>&1 | tee /tmp/anchor_test.txt | tail -100
