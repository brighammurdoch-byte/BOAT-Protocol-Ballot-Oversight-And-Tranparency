# BOAT ZK circuits — Groth16 private ballot (v0)

**Stack (locked):** Groth16 / BN254, offline prove + on-chain verify.

Transparent USU elections use `cast_vote` and do **not** need this package.

## Circuit (`circuits/vote.circom`)

Public inputs:

| Signal | Meaning |
|--------|---------|
| `merkleRoot` | Eligibility Merkle root committed on-chain |
| `nullifier` | `Poseidon(sk, electionId)` — uniqueness / double-vote prevention |
| `outcomeIndex` | Candidate index in `0 .. outcomeCount-1` |
| `electionId` | Field encoding of the election pubkey (first 31 bytes) |

Private inputs: voter secret `sk`, Merkle path (`pathElements`, `pathIndices`), and the leaf.

Constraints:

1. Leaf = `Poseidon(sk)` is a member of the eligibility Merkle tree (depth 8).
2. `nullifier = Poseidon(sk, electionId)`.
3. `outcomeIndex < outcomeCount` (parameterized; default max 16).

## TypeScript helpers

This package ships a **Poseidon-free SHA-256 Merkle** reference tree + a **Groth16-shaped proof blob** builder used by SDK/web until full Circom→snarkjs artifacts are generated:

```bash
cd packages/zk-circuits
npm install && npm run build && npm test
npm run demo:prove
```

After you install Circom (`circom` ≥ 2.1) and `snarkjs`:

```bash
./scripts/compile_circuit.sh   # produces build/vote.wasm + .r1cs
./scripts/setup_groth16.sh     # Powers of Tau → zkey → vk.json (dev ceremony)
```

Export verifying-key bytes for the on-chain verifier account / embedded VK with
`scripts/export_vk_bytes.ts`.

## Limits (honest)

- Not coercion-resistant; not campus-production until audited.
- Tiny electorate (Merkle depth 8 ⇒ ≤ 256 leaves).
- Single Groth16 proof per transaction (CU budget).
- Dev proving path may use a deterministic proof encoding for local/CI; production
  must use Circom + snarkjs (or equivalent) with a real ceremony VK matching the
  on-chain verifier.

See [`docs/ZK_STATUS.md`](../../docs/ZK_STATUS.md).
