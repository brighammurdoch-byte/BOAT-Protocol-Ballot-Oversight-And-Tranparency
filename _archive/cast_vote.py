import struct
import time
import json
import hashlib
from solana.rpc.api import Client
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta
from solders.transaction import Transaction
from solders.message import Message
from solders.system_program import ID as SYS_PROGRAM_ID
from spl.token.instructions import get_associated_token_address
from Voter import Voter
from ElectionInit import ElectionInit
from Candidate import Candidate

# --- CONFIGURATION ---
# 1. Your Deployed Program Address
PROGRAM_ID = Pubkey.from_string("4Gu2ktcq8wjcwA2MdxsKLdrffxkDm1MWY6gK44SymRwP")

# 2. Files and System Addresses
ADMIN_KEY_FILE = "admin.json"
TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
ASSOCIATED_TOKEN_PROGRAM_ID = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")

# --- HELPER FUNCTIONS ---

def get_discriminator(name):
    """Calculates the function ID for the smart contract"""
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]

def derive_pda(program_id, seeds):
    """Finds the address where data is stored"""
    return Pubkey.find_program_address(seeds, program_id)[0]

def pack_string(s):
    """Formats string for the blockchain"""
    b = s.encode('utf-8')
    return struct.pack("<I", len(b)) + b

# def send_and_confirm(client, keypair, instructions):
#     """Signs and transmits the vote"""
#     payer = keypair.pubkey()
#     print(f"📦 Packaging Vote Transaction...")
    
#     try:
#         latest_blockhash = client.get_latest_blockhash().value.blockhash
#         msg = Message(instructions, payer)
#         tx = Transaction([keypair], msg, latest_blockhash)
        
#         print("🚀 Sending Vote to Blockchain...")
#         signature = client.send_transaction(tx)
#         print(f"✅ Vote Cast Successfully!")
#         print(f"🔗 View on Explorer: https://explorer.solana.com/tx/{signature.value}?cluster=devnet")
#         return signature.value
#     except Exception as e:
#         print(f"❌ Error: {e}")
#         return None

# --- MAIN EXECUTION ---

def main():
    # 1. Connect to the Network
    client = Client("https://api.devnet.solana.com")
    print("✅ Connected to Devnet")


    # 2. Load the Admin
    try:
        with open(ADMIN_KEY_FILE, "r") as f:
            secret = json.load(f)
            admin_kp = Keypair.from_bytes(secret)
        print(f"👤 Admin Account: {admin_kp.pubkey()}")
    except FileNotFoundError:
        print(f"❌ Error: Could not find {ADMIN_KEY_FILE}")
        return
    
    # 3. Choose a Candidate
    title = f"Vote_{int(time.time())}"
    start_time = int(time.time())        
    end_time = int(time.time()) + 4000
    Alice = Candidate("Alice")
    candidate = [Alice] 
    print(f"🗳️  Voting for: {Alice}")

    # Make a voter
    Andy = Voter()
    voter_ls = [Andy]

    # 4. Build and Send
    big_election = ElectionInit(PROGRAM_ID, client, admin_kp, title, start_time, end_time, voter_ls, candidate)

    delay = 10
    print("⏳ Waiting " + str(delay) + " seconds for blockchain confirmation...") #Had to add wait for blockchain to catch up
    time.sleep(delay)
    
    vote_ix = Andy.cast_vote(PROGRAM_ID, admin_kp.pubkey(), Alice, title)

    if vote_ix:
        Andy.send_and_confirm(client, vote_ix, Andy.keypair, admin_kp)


if __name__ == "__main__":
    main()