#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
. "$HOME/.nvm/nvm.sh"
nvm use 22
avm use 1.1.2
REPO="/mnt/c/Users/brigh/College/Personal_Projects/BOAT/BOAT-Protocol-Ballot-Oversight-And-Tranparency"
cd "$REPO"
yarn add bn.js @types/bn.js --dev 2>/dev/null || yarn add bn.js
yarn install
anchor test --skip-build --validator legacy 2>&1 | tee /tmp/anchor_test.txt | tail -100
