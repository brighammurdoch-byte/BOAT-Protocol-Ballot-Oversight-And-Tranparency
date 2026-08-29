#!/usr/bin/env bash
# Dev-only Groth16 setup (NOT a production multi-party ceremony).
# Requires: circom artifacts in build/ from compile_circuit.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p build
NPX="npx --yes snarkjs@0.7.5"
# ~5k constraints need at least 2^13; use 14 for headroom
$NPX powersoftau new bn128 14 build/pot14_0000.ptau -v
$NPX powersoftau contribute build/pot14_0000.ptau build/pot14_0001.ptau --name="boat-dev" -e="boatdev$(date +%s)"
$NPX powersoftau prepare phase2 build/pot14_0001.ptau build/pot14_final.ptau
$NPX groth16 setup build/vote.r1cs build/pot14_final.ptau build/vote_0000.zkey
$NPX zkey contribute build/vote_0000.zkey build/vote_final.zkey --name="boat-dev-zkey" -e="boatzkey$(date +%s)"
$NPX zkey export verificationkey build/vote_final.zkey build/verification_key.json
echo "VK at build/verification_key.json"
echo "Next: npm run export-vk && npm run prove:snarkjs"
