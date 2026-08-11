# BOAT — modern Solana / Anchor toolchain (USU rebuild)
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    build-essential pkg-config libssl-dev libudev-dev git curl ca-certificates \
    python3 nodejs npm \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:$PATH"

RUN sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
ENV PATH="/root/.local/share/solana/install/active_release/bin:$PATH"

RUN cargo install --git https://github.com/solana-foundation/anchor avm --force \
    && avm install 1.1.2 \
    && avm use 1.1.2

WORKDIR /workspace
CMD ["/bin/bash"]
