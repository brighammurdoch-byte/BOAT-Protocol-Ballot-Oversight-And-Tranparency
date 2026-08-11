# BOAT — USU campus election quickstart

BOAT is a **side project** for transparent student officer elections on Solana (devnet first). DAO token voting is out of scope. ZK privacy is planned after the transparent path is solid.

## Toolchain (WSL recommended on Windows)

```bash
# In WSL
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
# or use scripts/setup_wsl_toolchain.sh

avm install 1.1.2 && avm use 1.1.2
node -v   # need >= 20.18
```

## Build & test (localnet)

```bash
cd BOAT-Protocol-Ballot-Oversight-And-Tranparency
anchor build
yarn install
anchor test --skip-build --validator legacy
```

Program id (this rebuild): see `Anchor.toml` / `target/idl/boat_final.json` → `address`.

## Deploy to Solana devnet

```bash
solana config set --url devnet
solana airdrop 2
anchor deploy --provider.cluster devnet --skip-build
```

If `anchor deploy` fails under congestion, use:

```bash
solana program deploy target/deploy/boat_final.so \
  --program-id target/deploy/boat_final-keypair.json
```

Then copy `target/idl/boat_final.json` into `packages/boat-sdk/src/idl/` and rebuild the SDK.

## Web Dapp

```bash
cd packages/boat-sdk && npm install && npm run build
cd ../../app/boat-frontend
npm install
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com npm run dev
```

Flows: `/admin` (create + register), `/vote`, `/election` (public tally).

## Thin API

```bash
cd apps/api && npm install
SOLANA_RPC=https://api.devnet.solana.com npm run dev
```

- `GET /health`
- `GET /elections/:pda`
- `GET /elections/:pda/tally`
- `POST /tx/initialize-election` — returns unsigned tx (base64) for wallet signing

## Mock officer election (script)

```bash
yarn demo:usu
# or: SOLANA_RPC=https://api.devnet.solana.com yarn demo:usu
```

## Mobile

Same USU flows as web. Set `EXPO_PUBLIC_SOLANA_RPC` if needed. Create-election defaults start **5 minutes in the future**.

```bash
cd apps/mobile
npm install --legacy-peer-deps
npx expo start --dev-client
```

## Trust model (transparent MVP)

- Election **authority** whitelist-registers voters.
- Votes are wallet-linkable on-chain (not anonymous).
- Anyone can recompute tallies from `VoterRegistry` accounts.
- Quorum % is displayed from config; not enforced on-chain.
