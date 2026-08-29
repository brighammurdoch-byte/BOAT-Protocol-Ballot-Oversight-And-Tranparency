# ZK voting — status after private-ballot v0 + ceremony VK

## Transparent layout (unchanged default)

- `cast_vote` remains the default; rejected when private mode is enabled.

## Private ballot v0

| Piece | Status |
|-------|--------|
| Circom circuit (`packages/zk-circuits/circuits/vote.circom`) | Compiled (depth 8 Merkle + nullifier + outcome) |
| Dev ceremony (snarkjs Powers of Tau) | Scripts + committed `build/verification_key.json` |
| Embedded on-chain VK | `programs/boat_final/src/verifying_key.rs` |
| `groth16-solana` verify | Wired when `dev_mode=false` |
| Dev binder proofs | Still used when `dev_mode=true` (trials / CI) |
| snarkjs prove + pack | `npm run prove:snarkjs` → 256-byte Solana proof |

### Regenerate VK / proofs

```bash
cd packages/zk-circuits
npm install
npm run compile    # needs `circom`
npm run setup      # local/dev ceremony only — NOT production MPC
npm run export-vk  # writes programs/boat_final/src/verifying_key.rs
npm run prove:snarkjs
```

### On-chain PDAs / instructions

Unchanged from v0: `PrivateBallotConfig`, `NullifierRecord`, `PrivateOutcomeTally`;
`enable_private_ballots`, `set_eligibility_root`, `cast_vote_zk`.

### Program id

`DgVtAKNDKiTYUowPBsXfDnv7Seq5hE3NsP1oMDexCoid` (keypair in `keys/`).

Deploy (needs ~2.2+ SOL on the deployer wallet):

```bash
./scripts/deploy_zk_devnet.sh
```

Publicdevnet airdrop is often rate-limited; fund via https://faucet.solana.com then re-run.

### Limits (honest)

- Local/dev Powers of Tau is **not** a production multi-party ceremony.
- SHA-256 Merkle helpers in TS are for **dev binder** path; Circom/Poseidon is the real circuit.
- Not coercion-resistant; not campus-production until audited + trusted setup.
- Tiny electorate (depth 8).

See also [`ZK_ROADMAP.md`](ZK_ROADMAP.md).
