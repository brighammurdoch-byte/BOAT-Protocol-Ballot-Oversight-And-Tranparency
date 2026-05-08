#!/bin/bash

# Exit on error
set -e

echo "Updating system packages..."
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libssl-dev git curl wget nodejs npm

# Remove system rust if present to avoid conflicts
sudo apt-get remove -y cargo rustc || true

echo "Installing Rust..."
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

echo "Installing Solana CLI..."
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Add to PATH permanently
if ! grep -q "solana/install/active_release/bin" ~/.bashrc; then
    echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
fi

echo "Installing Anchor CLI..."
# Use sudo for global npm install in WSL
sudo npm install -g @coral-xyz/anchor-cli

echo "Verifying installation..."
rustc --version
solana --version
anchor --version

echo "=================================================="
echo "Setup Complete! Run 'source ~/.bashrc' to finish."
echo "Then run 'anchor build' to compile."
echo "=================================================="