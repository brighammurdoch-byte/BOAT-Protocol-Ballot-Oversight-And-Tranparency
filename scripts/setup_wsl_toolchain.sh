#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "==> Rust"
rustup default stable
rustup update stable
rustc --version

echo "==> Anchor"
avm use 1.1.2
anchor --version

echo "==> Solana CLI"
if ! command -v solana >/dev/null 2>&1; then
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana --version

echo "==> Wallet"
mkdir -p "$HOME/.config/solana"
if [ ! -f "$HOME/.config/solana/id.json" ]; then
  solana-keygen new --no-bip39-passphrase -o "$HOME/.config/solana/id.json" --force
fi
solana address
solana config set --url localhost

echo "==> Done"
