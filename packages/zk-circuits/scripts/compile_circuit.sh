#!/usr/bin/env bash
# Compile vote.circom → build/ (requires circom >= 2.1 and circomlib).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p build
if ! command -v circom >/dev/null 2>&1; then
  echo "circom not found. Install: https://docs.circom.io/getting-started/installation/"
  exit 1
fi
if [[ ! -d node_modules/circomlib ]]; then
  npm install --no-save circomlib
fi
circom circuits/vote.circom --r1cs --wasm --sym -o build -l node_modules
echo "Wrote build/vote.r1cs and build/vote_js/"
