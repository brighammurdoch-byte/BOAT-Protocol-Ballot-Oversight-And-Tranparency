# Frontend status (USU rebuild)

## Web (`app/boat-frontend`)
- Home hub linking Admin / Vote / Public tally
- Admin: create election (start-in-future default), candidates, register voter pubkeys
- Vote: load outcomes, cast/change vote, Explorer receipt link
- Election: local registry tally from RPC (quorum from config when available)

## Mobile (`apps/mobile`)
- Same USU actions as web (create, add candidate, register, vote, public tally)
- Create-election defaults start **5 minutes** in the future
- RPC via `EXPO_PUBLIC_SOLANA_RPC` (defaults to public devnet)

## API (`apps/api`)
- `GET /health`, `GET /elections/:pda`, `GET /elections/:pda/tally`
- `POST /tx/initialize-election` (unsigned tx)

## Out of product scope for now
- DAO / token voting UI
- Delegation UI (instruction remains optional on-chain)
- Nostr forum (optional, not required for USU MVP)
- ZK private ballots (see `docs/ZK_STATUS.md` + `packages/zk-circuits`)
