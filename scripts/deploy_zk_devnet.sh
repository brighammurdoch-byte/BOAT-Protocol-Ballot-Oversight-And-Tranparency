#!/usr/bin/env bash
# Deploy boat_final (ZK-enabled) to Solana devnet.
# Requires a funded deployer wallet (~2.5+ SOL) at ~/.config/solana/id.json
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${HOME}/.cargo/bin:${PATH}"

cd "$ROOT"
solana config set --url https://api.devnet.solana.com >/dev/null
BAL=$(solana balance | awk '{print $1}')
echo "Deployer $(solana address) balance=${BAL} SOL"
python3 - <<PY
bal=float("${BAL}" or 0)
if bal < 2.2:
    raise SystemExit(
        "Need ~2.2+ SOL ondevnet. Fund via https://faucet.solana.com "
        f"or: solana airdrop 2  (current={bal})"
    )
PY

mkdir -p target/deploy
cp -f keys/boat_final-keypair.json target/deploy/boat_final-keypair.json
if [[ ! -f target/deploy/boat_final.so ]]; then
  anchor build
fi

solana program deploy target/deploy/boat_final.so \
  --program-id keys/boat_final-keypair.json \
  --url https://api.devnet.solana.com

echo "Deployed program id: $(solana-keygen pubkey keys/boat_final-keypair.json)"
echo "Then: SOLANA_RPC=https://api.devnet.solana.com yarn demo:usu"
echo "      SOLANA_RPC=https://api.devnet.solana.com yarn demo:zk"
