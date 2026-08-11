#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
. "$HOME/.nvm/nvm.sh"
nvm use 22
avm use 1.1.2
REPO="/mnt/c/Users/brigh/College/Personal_Projects/BOAT/BOAT-Protocol-Ballot-Oversight-And-Tranparency"
cd "$REPO"

solana config set --url devnet
echo "Address: $(solana address)"
echo "Balance: $(solana balance)"

# Airdrop (may rate-limit)
solana airdrop 2 || solana airdrop 1 || true
sleep 2
echo "Balance after airdrop: $(solana balance)"

# Deploy existing .so
solana program deploy target/deploy/boat_final.so \
  --program-id target/deploy/boat_final-keypair.json \
  --url devnet 2>&1 | tee /tmp/deploy_devnet.txt

# Sync IDL copies
mkdir -p packages/boat-sdk/src/idl app/boat-frontend/src/idl
cp target/idl/boat_final.json packages/boat-sdk/src/idl/boat_final.json
cp target/idl/boat_final.json app/boat-frontend/src/idl/boat_final.json

# Build SDK
cd packages/boat-sdk
yarn install || npm install
npm run build

echo "PROGRAM_ID=$(solana-keygen pubkey $REPO/target/deploy/boat_final-keypair.json)"
