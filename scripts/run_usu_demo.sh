#!/usr/bin/env bash
set -euo pipefail
. "$HOME/.nvm/nvm.sh"
nvm use 22
REPO="/mnt/c/Users/brigh/College/Personal_Projects/BOAT/BOAT-Protocol-Ballot-Oversight-And-Tranparency"
cd "$REPO"
SOLANA_RPC=https://api.devnet.solana.com yarn demo:usu 2>&1 | tee /tmp/usu_demo.txt
