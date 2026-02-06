import json
import hashlib
import time
import struct
from solana.rpc.api import Client
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta
from solders.transaction import Transaction
from solders.message import Message
from solders.system_program import ID as SYS_PROGRAM_ID

# If you are running this demo, go to line 48 and change the title before running the program.

# --- CONFIGURATION ---
# 1. Connect to Devnet
client = Client("https://api.devnet.solana.com")

# 2. YOUR Specific Program ID (From your deployment log)
PROGRAM_ID = Pubkey.from_string("EWatwsCrcnLninbUQV6yJzFreJHVhCnSm6LxB7aooHvg")

# 3. Load Admin Wallet
# Using the absolute path we found earlier to be safe
with open("admin.json", "r") as f:
    admin_keypair = Keypair.from_bytes(json.load(f))

print(f"🚀 Connected to Program: {PROGRAM_ID}")
print(f"👤 User: {admin_keypair.pubkey()}")

# --- HELPERS ---
def get_discriminator(name):
    """Generates the 8-byte instruction identifier"""
    # Anchor uses sha256("global:function_name")
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]

def get_pda(seeds):
    """Derives the address for a Program Derived Account"""
    addr, _ = Pubkey.find_program_address(seeds, PROGRAM_ID)
    return addr

def pack_string(s):
    """Packs a string for Borsh serialization (4 bytes length + string bytes)"""
    b = s.encode('utf-8')
    return struct.pack("<I", len(b)) + b

# --- MAIN LOGIC ---
def main():
    # This line must be changed for every election or else you will get an error. Each election 
    # must have a new name or else the app will read it as having already been created.
    election_title = f"Class Vice President {int(time.time())}"
    delay = 10
    
    # --- Step 1: Create Election ---
    print("\n--- 🗳️  1. Creating Election ---")
    
    # Find the Election Address (PDA)
    # Seeds: "election", owner_pubkey, title_string
    election_pda = get_pda([
        b"election", 
        bytes(admin_keypair.pubkey()), 
        election_title.encode()
    ])
    print(f"📍 Election Address: {election_pda}")

    # Prepare Instruction Data
    # Discriminator + Title
    ix_data = get_discriminator("create_election") + pack_string(election_title)
    
    # Define Accounts
    accounts = [
        AccountMeta(pubkey=admin_keypair.pubkey(), is_signer=True, is_writable=True), # owner (payer)
        AccountMeta(pubkey=election_pda, is_signer=False, is_writable=True),          # election
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),       # system_program
    ]
    
    # Send Transaction
    ix = Instruction(PROGRAM_ID, ix_data, accounts)
    tx = Transaction([admin_keypair], Message([ix], admin_keypair.pubkey()), client.get_latest_blockhash().value.blockhash)
    
    try:
        sig = client.send_transaction(tx)
        print(f"✅ Success! Election Created.\n   Tx: https://explorer.solana.com/tx/{sig.value}?cluster=devnet")
        print("⏳ Waiting " + str(delay) + " seconds for blockchain confirmation...") #Had to add wait for blockchain to catch up
        time.sleep(delay)
    except Exception as e:
        print(f"⚠️  Note: {e}")

    # --- Step 2: Register Voter ---
    print("\n--- 📝 2. Registering Voter ---")
    
    # Find Voter Address
    # Seeds: "voter", election_pda, payer_pubkey
    voter_pda = get_pda([
        b"voter", 
        bytes(election_pda), 
        bytes(admin_keypair.pubkey())
    ])
    
    # Prepare Data (Just discriminator, no args)
    ix_data = get_discriminator("register_voter")
    
    accounts = [
        AccountMeta(pubkey=admin_keypair.pubkey(), is_signer=True, is_writable=True), # payer
        AccountMeta(pubkey=voter_pda, is_signer=False, is_writable=True),             # voter
        AccountMeta(pubkey=election_pda, is_signer=False, is_writable=False),         # election
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),       # system_program
    ]
    
    ix = Instruction(PROGRAM_ID, ix_data, accounts)
    tx = Transaction([admin_keypair], Message([ix], admin_keypair.pubkey()), client.get_latest_blockhash().value.blockhash)
    
    try:
        sig = client.send_transaction(tx)
        print(f"✅ Success! Voter Registered.\n   Tx: https://explorer.solana.com/tx/{sig.value}?cluster=devnet")
        print("⏳ Waiting " + str(delay) + " seconds for blockchain confirmation...") # Had to add sleep so blockchain could catch up
        time.sleep(delay)
    except Exception as e:
        print(f"⚠️  Note: {e}")

    # --- Step 3: Cast Vote ---
    print("\n--- 🗳️  3. Casting Vote ---")
    
    # We are voting for ourselves (admin_keypair)
    candidate = admin_keypair.pubkey()
    
    # Prepare Data: Discriminator + Candidate Address (32 bytes)
    ix_data = get_discriminator("cast_vote") + bytes(candidate)
    
    accounts = [
        AccountMeta(pubkey=voter_pda, is_signer=False, is_writable=True),             # voter
        AccountMeta(pubkey=admin_keypair.pubkey(), is_signer=True, is_writable=False),# signer (authority)
        AccountMeta(pubkey=election_pda, is_signer=False, is_writable=False),         # election
    ]
    
    ix = Instruction(PROGRAM_ID, ix_data, accounts)
    tx = Transaction([admin_keypair], Message([ix], admin_keypair.pubkey()), client.get_latest_blockhash().value.blockhash)
    
    try:
        sig = client.send_transaction(tx)
        print(f"✅ Success! Vote Cast.\n   Tx: https://explorer.solana.com/tx/{sig.value}?cluster=devnet")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()