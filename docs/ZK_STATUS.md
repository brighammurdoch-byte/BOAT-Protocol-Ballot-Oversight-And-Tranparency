# ZK voting — status after USU transparent MVP

## Frozen transparent layout (do not break without migration)

From `programs/boat_final`:

- `Election` PDA: `["election", authority, title]`
- `ElectionConfig` PDA: `["config", election]`
- `ElectionOutcome` PDA: `["outcome", election, index]`
- `VoterRegistry` PDA: `["voter_registry", election, voter]`
- Vote state today: `VoterRegistry.current_vote: Option<String>` + `VoteCast` event (wallet-linkable)

## Target private model

1. Eligibility Merkle root (or SBT nullifier set) committed at registration close.
2. Ballot = commitment to outcome index + nullifier; ZK proof of:
   - membership in eligibility set,
   - nullifier uniqueness,
   - vote encrypts/commits to a valid outcome in `0..outcome_count`.
3. On-chain: verify proof, store nullifier, update aggregate counters (not per-wallet choice).

## Scaffold in this repo

- Circuit sketch: [`packages/zk-circuits/README.md`](../packages/zk-circuits/README.md)
- Program hook (feature-gated stub): `programs/boat_final` remains transparent-only until the verifier is ready; do not ship a half-broken instruction on campus elections.

## Next engineering steps

1. Pick proving system (Groth16 on BN254 vs others) compatible with Solana compute budget.
2. Prototype tiny-electorate circuit offline; generate verifying key.
3. Add `cast_vote_zk` instruction + nullifier PDA with verifier CPI/account.
4. Web “Private ballot” mode beside transparent `cast_vote`.
5. Devnet trial with ~10 voters before any campus claim of anonymity.

See also [`ZK_ROADMAP.md`](ZK_ROADMAP.md).
