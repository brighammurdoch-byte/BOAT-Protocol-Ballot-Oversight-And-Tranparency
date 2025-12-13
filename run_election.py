import struct
import hashlib
import time
import json
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.instruction import Instruction, AccountMeta
from solders.system_program import ID as SYS_PROGRAM_ID
from solders.sysvar import RENT
from solana.rpc.api import Client
from solders.transaction import Transaction
from solders.message import Message
from spl.token.instructions import get_associated_token_address
from Voter import Voter
from ElectionInit import ElectionInit
from Candidate import Candidate

# CONSTANTS
PROGRAM_ID = Pubkey.from_string("4Gu2ktcq8wjcwA2MdxsKLdrffxkDm1MWY6gK44SymRwP")
ADMIN_KEY_FILE = "admin.json"
TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
ASSOCIATED_TOKEN_PROGRAM_ID = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")

def get_discriminator(name):
    """Calculates the function ID for Anchor programs"""
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]

def derive_pda(program_id, seeds):
    """Finds the Program Derived Address"""
    return Pubkey.find_program_address(seeds, program_id)[0]

def pack_string(s):
    """Converts a string to the format Rust expects (Length + Bytes)"""
    b = s.encode('utf-8')
    return struct.pack("<I", len(b)) + b

def send_and_confirm(client, keypair, instructions):
    """Signs and sends a transaction"""
    payer = keypair.pubkey()
    print(f"📦 Packaging {len(instructions)} instruction(s)...")
    
    latest_blockhash = client.get_latest_blockhash().value.blockhash
    msg = Message(instructions, payer)
    tx = Transaction([keypair], msg, latest_blockhash)
    
    print("🚀 Sending transaction...")
    try:
        signature = client.send_transaction(tx)
        print(f"✅ Success! Tx: https://explorer.solana.com/tx/{signature.value}?cluster=devnet")
        return signature.value
    except Exception as e:
        print(f"❌ Error: {e}")
        return None


def main():
    #Test an election

    # 1. Connect
    client = Client("https://api.devnet.solana.com")
    print("✅ Connected to Devnet")

    
    # 2. Load Admin
    try:
        with open(ADMIN_KEY_FILE, "r") as f:
            secret = json.load(f)
            admin_keypair = Keypair.from_bytes(secret)
        print(f"👤 Admin Account: {admin_keypair.pubkey()}")
    except FileNotFoundError:
        print(f"❌ Error: Could not find {ADMIN_KEY_FILE}.")
        return
    

    election_title = f"Vote_{int(time.time())}"
    start_time = int(time.time())        
    end_time = int(time.time()) + 4000
    candidates = ["Bob", "Alice"]

    print(f"🏛️  Initializing Election: '{election_title}'")

    candidate_ls = []
    #Initialize candidates
    candidate_indx = 0
    for candidate in candidates:
        candidate_ls.append(Candidate(candidate))
        candidate_indx += 1

    #Initialize list of voters.
    voter_ls = []
    for person in range(5):
        voter_ls.append(Voter())


    #Initialize Election
    my_election = ElectionInit(PROGRAM_ID, client, admin_keypair, election_title, start_time, end_time, voter_ls, candidate_ls)


main()