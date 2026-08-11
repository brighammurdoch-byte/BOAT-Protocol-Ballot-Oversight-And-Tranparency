#!/usr/bin/env bash
# Dev-only Groth16 setup (NOT a production ceremony).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p build
if ! command -v snarkjs >/dev/null 2>&1; then
  npx --yes snarkjs@0.7.5 powersoftau new bn128 14 build/pot14_0000.ptau -v
  NPX="npx --yes snarkjs@0.7.5"
else
  NPX="snarkjs"
fi
$NPX powersoftau new bn128 14 build/pot14_0000.ptau -v
$NPX powersoftau contribute build/pot14_0000.ptau build/pot14_0001.ptau --name="boat-dev" -e="boat dev entropy"
$NPX powersoftau prepare phase2 build/pot14_0001.ptau build/pot14_final.ptau
$NPX groth16 setup build/vote.r1cs build/pot14_final.ptau build/vote_0000.zkey
$NPX zkey contribute build/vote_0000.zkey build/vote_final.zkey --name="boat-dev-zkey" -e="boat zkey entropy"
$NPX zkey export verificationkey build/vote_final.zkey build/verification_key.json
echo "VK at build/verification_key.json — export bytes with scripts/export_vk_bytes.ts"
