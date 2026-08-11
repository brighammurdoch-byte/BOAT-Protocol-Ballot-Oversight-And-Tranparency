# ZK voting — status after private-ballot v0

## Transparent layout (unchanged default)

From `programs/boat_final`:

- `Election` PDA: `["election", authority, title]`
- `ElectionConfig` PDA: `["config", election]`
- `ElectionOutcome` PDA: `["outcome", election, index]`
- `VoterRegistry` PDA: `["voter_registry", election, voter]`
- Transparent vote state: `VoterRegistry.current_vote` + `VoteCast` (wallet-linkable)
- Instruction: `cast_vote` — **rejected** when private mode is enabled

## Private ballot v0 (this branch)

Stack: **Groth16 / BN254** circuit sketch + offline prove helpers; on-chain nullifier + aggregate tallies.

### Extra PDAs (do not alter transparent account layouts)

| Account | Seeds | Role |
|---------|-------|------|
| `PrivateBallotConfig` | `["private", election]` | `enabled`, `dev_mode`, Merkle root, vote count |
| `NullifierRecord` | `["nullifier", election, nullifier]` | Double-vote prevention |
| `PrivateOutcomeTally` | `["private_tally", election, index]` | Aggregate weight per outcome |

### Instructions

1. `enable_private_ballots(root, dev_mode)` — before `start_time`
2. `set_eligibility_root(root)` — before `start_time`
3. `cast_vote_zk(outcome, nullifier, proof[256], public_inputs[4])` — verifies proof, stores nullifier, increments tally

Public inputs: `[merkleRoot, nullifier, outcomeIndex, electionId]`.

### Dev vs production verify

- `dev_mode=true`: accepts deterministic binder proofs from `@boat/zk-circuits` / web helpers (`BOAT_GROTH16_DEV_V0`). **Not secure** — for localnet / tiny trials only.
- `dev_mode=false`: requires production Groth16 verify (`groth16-solana` hook in `zk_verify.rs`) once a ceremony verifying key is embedded. Currently returns `ZkVerifierNotConfigured`.

### Circuit package

[`packages/zk-circuits`](../packages/zk-circuits): Circom `vote.circom` (Poseidon Merkle depth 8 + nullifier + outcome bound), TS Merkle/proof helpers, compile/setup scripts.

```bash
cd packages/zk-circuits && npm install && npm test && npm run demo:prove
# With circom + snarkjs installed:
./scripts/compile_circuit.sh && ./scripts/setup_groth16.sh
```

### Client paths

- SDK: `enablePrivateBallots`, `castVoteZk`, `fetchPrivateConfig`, `fetchPrivateTallies`
- Web: Admin → “Enable private ballots”; Vote page switches to private UI; tally shows aggregate counters
- Script: `yarn demo:zk` (~8 private votes)

### Limits (honest)

- Not coercion-resistant
- Not campus-production until audited + real VK
- Tiny electorate (depth 8 ⇒ ≤ 256 leaves)
- Single proof per transaction

### Program id note

Transparent MVP was previously deployed at `HFr5VbxjxszddWUUaayzbxQ2onD6EzfNcCG2hTXQ8ga6`.
This ZK-enabled binary uses `CjFvbqigpnjPQFZKYHQDGa1jpYtnBxZaaVjWKjg3anZ` (keypair under `keys/`) because the prior upgrade authority was not available in CI. Point clients at the IDL address after deploy.

See also [`ZK_ROADMAP.md`](ZK_ROADMAP.md).
