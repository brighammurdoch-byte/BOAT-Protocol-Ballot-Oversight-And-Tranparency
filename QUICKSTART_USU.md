# BOAT — USU campus election quickstart

BOAT is a **side project** for transparent student officer elections on Solana (devnet first). DAO token voting is out of scope. ZK privacy is in progress (`docs/ZK_STATUS.md`).

Program id (rebuild): `HFr5VbxjxszddWUUaayzbxQ2onD6EzfNcCG2hTXQ8ga6`

## Toolchain (WSL recommended on Windows)

```bash
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
# or scripts/setup_wsl_toolchain.sh

avm install 1.1.2 && avm use 1.1.2
node -v   # need >= 20.18
```

## Build & test (localnet)

```bash
anchor build
yarn install
anchor test --skip-build --validator legacy
```

## Deploy to Solana devnet

```bash
solana config set --url devnet
solana airdrop 2
solana program deploy target/deploy/boat_final.so \
  --program-id target/deploy/boat_final-keypair.json
```

Copy `target/idl/boat_final.json` into `packages/boat-sdk/src/idl/` and `app/boat-frontend/src/idl/`, then rebuild the SDK.

## Web Dapp

```bash
cd packages/boat-sdk && npm install && npm run build
cd ../../app/boat-frontend
npm install
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com npm run dev
```

Static export / host: see [`app/boat-frontend/DEPLOY.md`](app/boat-frontend/DEPLOY.md).

Shareable links: `/vote?pda=<ElectionPDA>` and `/election?pda=<ElectionPDA>`.

## 10-minute Phantom checklist (Devnet)

1. Install Phantom; switch network to **Devnet**; fund wallet via faucet.
2. Open the web app → **Admin** → connect wallet.
3. Set title, start in **5+ minutes**, add candidates → **Create election + candidates**.
4. Copy the election PDA; use **Open vote link** / **Open tally link**.
5. Paste voter pubkeys (including your Phantom address) → **Register voters**.
6. Wait until the countdown shows voting is open (or lower “start in minutes” on a fresh election for demos).
7. Open **Vote** (share link), connect the registered wallet, load candidates, cast a ballot → confirm Explorer receipt.
8. Open **Public tally** and confirm your candidate’s bar / weight updated.
9. Optional: change vote once; tally should move with you.

Automated smoke (no Phantom):

```bash
SOLANA_RPC=https://api.devnet.solana.com yarn demo:usu
```

## Thin API

```bash
cd apps/api && npm install
SOLANA_RPC=https://api.devnet.solana.com npm run dev
```

- `GET /health`
- `GET /elections/:pda`
- `GET /elections/:pda/tally`
- `POST /tx/initialize-election` — unsigned tx (base64) for wallet signing

## Mobile

Same USU flows as web. `EXPO_PUBLIC_SOLANA_RPC` defaults to public Devnet. Create-election starts **5 minutes** in the future.

```bash
cd apps/mobile
npm install --legacy-peer-deps
npx expo start --dev-client
```

## Trust model (transparent MVP)

- Election **authority** whitelist-registers voters.
- Votes are wallet-linkable on-chain (not anonymous) unless private mode + ZK is enabled.
- Anyone can recompute tallies from `VoterRegistry` (transparent) or aggregate counters (private).
- Quorum % is displayed from config; not enforced on-chain.
