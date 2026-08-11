> **Historical (March 2026).** Applies only to the archived Anchor 0.29 program. The live program uses Anchor 1.1.2 with a thin Cargo.toml — do not re-apply these pins.

# Dependency Resolution Summary & Build Constraints

**Date:** March 5, 2026
**Target Environment:** Solana Devnet
**Toolchain:** Rust 1.75.0 (Solana SBF), Anchor 0.29.0

## 🚨 CRITICAL WARNING FOR AI ASSISTANTS 🚨

**DO NOT ATTEMPT TO UPDATE OR UNPIN DEPENDENCIES IN `programs/boat_final/Cargo.toml` WITHOUT EXTREME CAUTION.**

The current configuration is a fragile equilibrium required to build on the Solana BPF target (Rust 1.75.0) while avoiding bleeding-edge crates that require Rust 1.76+ or 1.82+.

## 1. The Core Problem: `wit-bindgen` & Rust Versions
*   **Issue:** Transitive dependencies (via `wasm-bindgen` or build scripts) try to pull `wit-bindgen` v0.51.0+.
*   **Constraint:** `wit-bindgen` v0.51.0+ requires Rust 1.82 (edition 2024 features), which is incompatible with the current Solana toolchain.
*   **Solution:** We explicitly pin `wit-bindgen = "=0.19.2"` in the program manifest to force resolution to the older, compatible version.

## 2. The `ahash` / `hashbrown` / `indexmap` Web
*   **Issue:** `solana-program = "=1.16.27"` (used for stability) strictly requires `ahash = "=0.8.4"`.
*   **Conflict:** Newer versions of `hashbrown` (0.14.x) and `indexmap` (2.x) try to pull `ahash` 0.8.7+, causing resolution failures.
*   **Solution:** We aggressively pin the entire bottom of the stack:
    *   `ahash = "=0.8.4"`
    *   `hashbrown = "=0.12.3"`
    *   `indexmap = "=1.9.3"`

## 3. System Crates (`rustix`, `errno`)
*   **Issue:** Newer versions of `rustix` and `errno` fail to compile for the `sbf-solana-solana` target (OS error: "file not found for module sys").
*   **Solution:** Do **NOT** add `rustix` or `errno` as direct dependencies. Let the pinned `nix` or `libc` versions handle it transitively via the older `solana-program` stack.

## 4. Stack Overflow (4KB Limit)
*   **Issue:** Adding `curve25519-dalek` or `solana-zk-token-sdk` caused the program stack usage to exceed the 4096-byte limit (`Stack offset of 491688...`).
*   **Solution:** These dependencies were removed. Do not re-add them unless absolutely necessary, and if so, ensure they are zero-copy or heap-allocated.

## 5. Build Dependencies (`toml`, `proc-macro`)
*   **Issue:** `toml_edit` and `toml_parser` released versions requiring Rust 1.76+.
*   **Solution:** Pinned `toml_edit = "=0.19.8"` and `toml = "=0.5.11"`.

## Current Working Configuration (Anchor 0.29.0)

If you need to modify `Cargo.toml`, ensure these pins remain intact:

```toml
[dependencies]
anchor-lang = { version = "0.29.0", features = ["init-if-needed"] }
anchor-spl = { version = "0.29.0", features = ["associated_token"] }
solana-program = "=1.16.27"
# solana-zk-token-sdk = "=1.16.27" # REMOVED to save stack space
ahash = "=0.8.4"
hashbrown = "=0.12.3"
indexmap = "=1.9.3"
wit-bindgen = "=0.19.2"
wasm-bindgen = "=0.2.87"
getrandom = { version = "=0.2.10", features = ["custom"] }
base64 = "=0.13.0"
```

**Deployment Note:**
If deployment fails with "write transactions failed", it is network congestion. Use `solana program deploy` directly instead of `anchor deploy`.

**Client Note:**
The Python client scripts (`ElectionInit.py`, `Voter.py`) must manually construct the `AccountMeta` list to match the Anchor context exactly, including `election_config` and `voter_registry` PDAs.