# Frontend status (BOAT)

This repo currently contains **two frontend surfaces**:

1. **Web / PWA (static export)** in `app/boat-frontend`
2. **Mobile (Expo / React Native)** in `apps/mobile`

Both are intended to be **trust-minimized clients**:
- They read **Solana RPC directly** (no BOAT-hosted backend for votes/tallies).
- “Forum” is **not stored on-chain**; it uses public Nostr relays (see below).

## What’s implemented

### Web / PWA (`app/boat-frontend`)
- **Static export** (`next.config.ts` sets `output: "export"`).
- **Wallet connect UI** using Solana Wallet Adapter (web wallets).
  - Works best when opened inside a wallet’s in-app browser on mobile (Phantom/Solflare).
- **Election input**: paste the **Election PDA** (base58) and load a local tally.
- **Transparency / verification (basic)**:
  - Fetches `VoterRegistry` accounts for an election and computes totals locally (weights).
  - Displays your wallet and your `VoterRegistry` row (if present) for self-checking.
- **Forum (prototype)**:
  - Posts/reads messages via public Nostr relays tagged by election address (`boat_election`).
  - Posts currently use an **ephemeral Nostr key** per publish (no persistent identity).

### Mobile (`apps/mobile`)
- Upgraded to **Expo SDK 54** (React Native 0.81 / React 19).
- Basic screens:
  - Connect (Mobile Wallet Adapter authorize flow)
  - Paste election PDA and compute a local tally
  - Forum screen using the same Nostr tagging approach

### Smart contract support that the frontend expects
The program has been extended beyond the original demo to support:
- **On-chain outcomes** (candidate list)
- **Election-scoped `VoteCast` events** (include election pubkey)
- **Admin-sponsored registration** (voter signs, admin pays)

## What’s not done (yet)

### Core product UX gaps
- **No full “Admin UI” flow** in the clients yet (create election, set config, add outcomes, sponsor-register).
  - The on-chain instructions exist, but the UI wiring is not complete.
- **No full “Voter flow” UI** (sponsored registration request flow, delegate flow, vote change fee UX).

### Transparency limitations (known)
- Current local tally is **registry-based** (uses `VoterRegistry.current_vote` and weight).
- **Token-based voting without a registry row** is not included in the simple tally.
- No “receipt” UI that walks users through signatures/logs end-to-end yet (planned).

### Privacy / ZK voting
- **Not implemented**.
- Current system is **not anonymous**: votes are linkable to wallet public keys on-chain.
- See `docs/ZK_ROADMAP.md` for the intended direction and constraints.

### Forum limitations (prototype)
- Relies on third-party Nostr relay availability and policies.
- Ephemeral keys mean no stable identity, editing, moderation, etc.

## How to run

### Web / PWA (static export)
Build static output:

```bash
cd app/boat-frontend
npm install
npm run build
```

Serve the `out/` folder (example):

```bash
py -m http.server 5173 --directory out --bind 0.0.0.0
```

Open in a wallet browser (recommended on mobile):
- Phantom → Browser → paste URL
- Solflare → Browser → paste URL

### Mobile (Expo)

```bash
cd apps/mobile
npm install --legacy-peer-deps
npx expo start --dev-client
```

If testing over USB, use `adb reverse` to forward Metro’s port to the device.

## Next steps (recommended)
- Build out the full Admin + Voter flows in mobile first (best matches dApp store UX).
- Add a “verify my vote” screen that:
  - shows the user’s registry row
  - links to transaction signatures
  - explains tally rules and quorum
- Decide whether the forum should remain Nostr-based or move to a different decentralized social layer.

