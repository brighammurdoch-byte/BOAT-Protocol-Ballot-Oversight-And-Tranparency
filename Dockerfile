# Modern Ubuntu with Rust toolchain for Solana development
FROM ubuntu:24.04

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    libssl-dev \
    libudev-dev \
    git \
    curl \
    wget \
    nodejs \
    npm \
    ca-certificates \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Install Rust (latest stable)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:$PATH"

# Verify Rust installation
RUN rustc --version && cargo --version

# Install Solana CLI
RUN sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
ENV PATH="/root/.local/share/solana/install/active_release/bin:$PATH"

# Install Anchor CLI (latest)
RUN npm install -g @coral-xyz/anchor-cli

# Verify Anchor installation
RUN anchor --version

# Set working directory
WORKDIR /workspace

# Copy project files
COPY . .

# Install Node dependencies
RUN npm install 2>/dev/null || true

# Default command - provides shell access for building
CMD ["/bin/bash"]
