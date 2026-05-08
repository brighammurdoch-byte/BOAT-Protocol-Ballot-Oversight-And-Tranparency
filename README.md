# BOAT Protocol: Ballot Oversight and Transparency

[![Solana](https://img.shields.io/badge/Built%20on-Solana-00d1b2?logo=solana&logoColor=white)](https://solana.com)
[![Anchor](https://img.shields.io/badge/Framework-Anchor-9933ff)](https://www.anchor-lang.com)

**BOAT Protocol** is a full-fledged, on-chain voting system built on the **Solana blockchain** for maximum transparency, verifiability, and efficiency. Votes are recorded immutably on-chain, ensuring auditability and resistance to tampering.

**Initial focus:** Corporate elections (e.g., shareholder voting, board decisions).  
**Long-term vision:** A flexible protocol for **any type of voting** — DAOs, community polls, elections, governance, etc.

**Status:** Early development / heavy demoing phase. Core smart contract logic is in progress with Anchor and Rust.

## Features (Current & Planned)
- Immutable on-chain vote casting and tallying
- Soulbound Tokens (SBTs) for voter authentication & eligibility (via `sbt_mint.json` integration)
- Transparent audit trails — every vote verifiable via Solana explorer
- Admin controls (e.g., election init, candidate management)
- Modular design: Easily extend to different voting types
- Potential frontend/client (TypeScript/Node) for user interaction
- Archived prototypes & Python helpers for testing/experimentation

## Frontend status
- See `FRONTEND_STATUS.md` for what’s implemented vs pending for:
  - Web/PWA (`app/boat-frontend`)
  - Mobile (Expo) (`apps/mobile`)

## Tech Stack
- **Blockchain**: Solana
- **Smart Contract Framework**: Anchor
- **Program Language**: Rust
- **Backend**: Rust (via Anchor/Cargo)
- **Frontend/CLI**: TypeScript/JavaScript (Node.js, Yarn)
- **Other**: Python (prototypes & utils), JSON configs (admin, SBT minting)

## Setup Instructions (Windows Users)
To build the smart contract (`anchor build`), you must use **WSL (Windows Subsystem for Linux)**.

1. **Install Ubuntu:**
   ```powershell
   wsl --install -d Ubuntu
   ```
2. **Reboot your computer.**
3. **Open Ubuntu** from your Start Menu and run the following commands inside the Linux terminal:

   **A. Install Rust:**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   # (Type 1 and press Enter when prompted)
   source "$HOME/.cargo/env"
   ```

   **B. Install Solana:**
   ```bash
   sh -c "$(curl -sSfL https://release.solana.com/v1.18.18/install)"
   export PATH="/home/$(whoami)/.local/share/solana/install/active_release/bin:$PATH"
   ```

   **C. Install Anchor:**
   ```bash
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   avm install latest
   avm use latest
   ```
