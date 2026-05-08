# BOAT election forum (decentralized)

## Summary

Election-scoped discussion uses **public Nostr relays** and a dedicated tag so clients can filter without a BOAT-hosted database.

## Tag convention

- Tag name: `boat_election`
- Tag value: Solana **election account** address, base58 (same string users paste for tally).

Each forum `kind: 1` note includes:

```text
tags: [["boat_election", "<electionPubkeyBase58>"]]
content: free-form text (Markdown recommended by clients)
```

## Relays

Default relay URLs live in `@boat/sdk` as `DEFAULT_FORUM_RELAYS`. Operators and users may change relays in app settings; messages are only as durable as relay policy.

## Trust model

- **Not tied to Solana signatures**: Nostr keys are separate (the mobile and web demos generate an ephemeral secp256k1 key per post for simplicity). Production apps may derive or link identities differently.
- **No BOAT server**: the app only speaks WebSocket to third-party relays. There is no canonical BOAT aggregation service for forum content.

## Solana dApp Store

Disclose which relays you default to and that forum availability depends on those relays.
