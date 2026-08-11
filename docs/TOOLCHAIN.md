# Toolchain (Anchor 1.1 rebuild)

BOAT was rebuilt in August 2026 to escape the Anchor **0.29** / BPF pin soup.

| Tool | Version |
|------|---------|
| Anchor CLI / crates | **1.1.2** |
| Solana / Agave CLI | stable (4.x on build host) |
| Rust | stable (1.97+ recommended) |
| Node | **>= 20.18** (required by `@anchor-lang/core`) |
| TS client package | `@anchor-lang/core` (replaces `@coral-xyz/anchor`) |

## Build without Docker

```bash
avm use 1.1.2
anchor build
anchor test --skip-build --validator legacy
```

Anchor 1.x defaults to **Surfpool** for `anchor test`. Until Surfpool is installed, pass `--validator legacy` to use `solana-test-validator`.

Verifiable/docker builds (`anchor build -v`) need Docker Desktop WSL integration.

## Program id

Generated at rebuild time; see `Anchor.toml` and `target/idl/boat_final.json`.

Old 0.29 program archived at `_archive/programs/boat_final_0_29/`.
