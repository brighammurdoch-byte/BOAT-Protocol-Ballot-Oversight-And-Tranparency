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
from Candidate import Candidate

TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
ASSOCIATED_TOKEN_PROGRAM_ID = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")

#The actual election is run on the blockchain, so I'll call this class the Election Initializer
class ElectionInit():
    def __init__(self, program_id, client, admin_keypair, title, start_ts, end_ts, voters, weights, candidates):
        self.program_id = program_id
        self.admin_keypair = admin_keypair
        self.title = title
        self.start_ts = start_ts
        self.end_ts = end_ts
        self.voters = voters
        self.candidates = candidates

        # 1. Find Addresses (PDAs)
        election_pda = self.derive_pda(program_id, [b"election", bytes(admin_keypair.pubkey()), title.encode()])
        mint_pda = self.derive_pda(program_id, [b"mint", bytes(election_pda)])
        
        # 2. Pack Data
        # Discriminator + Title (String) + Start (i64) + End (i64)
        # <qq means "Little Endian, Signed Long Long (8 bytes)" x 2
        ix_data = self.get_discriminator("initialize_election") + self.pack_string(title) + struct.pack("<qq", start_ts, end_ts)
        
        # 3. Define Accounts (Must match lib.rs EXACTLY)
        accounts = [
            AccountMeta(pubkey=admin_keypair.pubkey(), is_signer=True, is_writable=True),
            AccountMeta(pubkey=election_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=mint_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=RENT, is_signer=False, is_writable=False),
        ]

        ix = []
        ix.append(Instruction(program_id, ix_data, accounts))

        for voter in voters and for weight in weights:
            ix.append(voter.register_voter(program_id, admin_keypair.pubkey(), voters[voter].keypair.pubkey(), title, weights[voters]))

        tx_signature = self.send_and_confirm(client, admin_keypair, ix)
        
        
    
        # 3. Create the link
        explorer_link = f"https://explorer.solana.com/tx/{tx_signature}?cluster=devnet"
        
        print(f"✅ Election Successfully Initialized!")
        print(f"🔗 Proof: {explorer_link}")


    def get_discriminator(self, name):
        """Calculates the function ID for Anchor programs"""
        return hashlib.sha256(f"global:{name}".encode()).digest()[:8]

    def derive_pda(self, program_id, seeds):
        """Finds the Program Derived Address"""
        return Pubkey.find_program_address(seeds, program_id)[0]

    def pack_string(self, s):
        """Converts a string to the format Rust expects (Length + Bytes)"""
        b = s.encode('utf-8')
        return struct.pack("<I", len(b)) + b

    def send_and_confirm(self, client, keypair, instructions):
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


    def register_voter(program_id, admin_pubkey, voter_pubkey, title):
        # Derive Addresses
        election_pda = derive_pda(program_id, [b"election", bytes(admin_pubkey), title.encode()])
        mint_pda = derive_pda(program_id, [b"mint", bytes(election_pda)])
        voter_ata = get_associated_token_address(voter_pubkey, mint_pda, TOKEN_2022_PROGRAM_ID)
        
        # Discriminator + Weight (1 vote)
        ix_data = get_discriminator("register_voter") + struct.pack("<Q", 1)

        accounts = [
            AccountMeta(pubkey=admin_pubkey, is_signer=True, is_writable=True),
            AccountMeta(pubkey=election_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=mint_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=voter_pubkey, is_signer=False, is_writable=False), # Voter Wallet
            AccountMeta(pubkey=voter_ata, is_signer=False, is_writable=True),     # Voter Token Account
            AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=ASSOCIATED_TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
        ]
        return Instruction(program_id, ix_data, accounts)


