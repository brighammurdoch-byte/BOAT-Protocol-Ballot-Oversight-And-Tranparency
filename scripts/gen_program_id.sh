#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
REPO="/mnt/c/Users/brigh/College/Personal_Projects/BOAT/BOAT-Protocol-Ballot-Oversight-And-Tranparency"
cd "$REPO"
rm -rf programs/boat_final/src/dot
mkdir -p target/deploy
solana-keygen new --no-bip39-passphrase -o target/deploy/boat_final-keypair.json --force
PUB=$(solana-keygen pubkey target/deploy/boat_final-keypair.json)
echo "PROGRAM_ID=$PUB"
python3 - <<PY
from pathlib import Path
import re
pub = """$PUB"""
lib = Path("programs/boat_final/src/lib.rs")
text = lib.read_text()
text = re.sub(r'declare_id!\("[^"]+"\);', f'declare_id!("{pub}");', text)
lib.write_text(text)
anchor = Path("Anchor.toml")
a = anchor.read_text()
a = a.replace("REPLACE_ME", pub)
anchor.write_text(a)
print("updated declare_id and Anchor.toml to", pub)
PY
