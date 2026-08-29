# BOAT

**Ballot Oversight And Transparency** — a Solana side project for transparent campus elections (e.g. USU school officers), with a ZK private-ballot path.

This is **not** a DAO governance protocol. Token-weighted / corporate voting surfaces were removed in the Anchor 1.x rebuild.

## What’s in the repo

| Piece | Path |
|-------|------|
| On-chain program (Anchor **1.1.2**) | `programs/boat_final` |
| TypeScript SDK | `packages/boat-sdk` |
| ZK circuits / helpers | `packages/zk-circuits` |
| Web Dapp | `app/boat-frontend` |
| HTTP API (read + tx build) | `apps/api` |
| Mobile (same USU UX) | `apps/mobile` |
| USU quickstart | [`QUICKSTART_USU.md`](QUICKSTART_USU.md) |
| ZK status | [`docs/ZK_STATUS.md`](docs/ZK_STATUS.md) |

## Quick links

- Build / test / deploy: [`QUICKSTART_USU.md`](QUICKSTART_USU.md)
- Modern toolchain notes: [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md)
- Historical 0.29 dependency hell (do not revive): [`docs/archive/DEPENDENCY_RESOLUTION_SUMMARY.md`](docs/archive/DEPENDENCY_RESOLUTION_SUMMARY.md)

## Status

Transparent MVP: authority registration, outcomes, cast/change vote, client-side tally, web + API + mobile.

Private ballot v0: optional `enable_private_ballots` + `cast_vote_zk` (nullifier PDA + aggregate tallies). Transparent `cast_vote` remains the default. See [`docs/ZK_STATUS.md`](docs/ZK_STATUS.md).

Program id (ZK-enabled rebuild): `DgVtAKNDKiTYUowPBsXfDnv7Seq5hE3NsP1oMDexCoid`
