# BOAT — Zero-knowledge voting roadmap

## Current state (transparent model)

The deployed Anchor program records **each voter’s public key** on `VoterRegistry` and emits **`VoteCast` events that include the voter pubkey**. Any client can tally and audit, but **ballots are not anonymous** on-chain.

## Goal (ZK model)

Allow **eligibility** and **correct tally** to be verified without revealing which public key voted for which option—typically via:

- A **commitment / nullifier** scheme so one eligible voter ≤ one counted ballot, and
- A **ZK proof** checked on-chain (or on a attached verifier) that the ballot is valid and updates only aggregate counters or encrypted aggregates.

## Threat model (sketch)

| Actor | Sees today | Should see after ZK |
|-------|----------------|---------------------|
| Chain observer | Wallet ↔ vote | Only commitments / aggregates |
| Coercer | Observable on-chain vote | Ideally deniable or time-limited reveal (hard) |
| Voter | Own tx | Receipt that proof verified without leaking choice |

Coercion-resistance and receipt-freeness are **orthogonal** hard problems; ZK alone does not solve coercion.

## Solana implementation lanes

1. **On-chain verifier (Groth16 / similar)**  
   - Circuit proves Merkle membership of an eligible leaf + correct nullifier update.  
   - Anchor instruction verifies proof bytes.  
   - Proving cost on mobile is the main engineering constraint.

2. **Off-chain prove, on-chain verify batched**  
   - Provers batch many votes; chain verifies a smaller number of proofs per slot.

3. **External rollup / VM**  
   - Solana holds commitments; proofs posted periodically. Simpler chain footprint, more moving parts.

## Recommended sequencing

1. Ship **transparent** BOAT with **local tally + registry verification** (done in `@boat/sdk` tally helpers).
2. Freeze **data layout** for elections and nullifier set design; external audit.
3. Prototype circuit + verifier with **tiny electorate** on localnet.
4. Only then extend production program—migrations for live elections need governance.

## Out of scope for frontend-only work

Anonymous voting **cannot** be added by UI alone; it requires **program + cryptography** changes and a proving system suitable for your electorate size and mobile performance budget.
