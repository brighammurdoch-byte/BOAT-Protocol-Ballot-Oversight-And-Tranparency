# BOAT ZK circuits (scaffold)

This package is a **placeholder** for the private-ballot circuit work described in `docs/ZK_STATUS.md`.

Transparent USU elections use `cast_vote` on-chain without this package.

## Planned contents

- Circom / Noir / (chosen DSL) circuit: eligibility + nullifier + outcome commitment
- Scripts to export verifying key bytes for an Anchor verifier account
- Local proving helpers for web/mobile (WASM) once stack is chosen

## Do not claim

Anonymous voting is **not** implemented until proofs verify on-chain and nullifiers are enforced.
