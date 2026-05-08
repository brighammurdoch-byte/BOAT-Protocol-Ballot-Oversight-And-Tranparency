import struct
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.instruction import Instruction, AccountMeta
from solders.system_program import ID as SYS_PROGRAM_ID
from solders.sysvar import RENT
from solana.rpc.api import Client
from solders.transaction import Transaction
from solders.message import Message
from utils import (
    get_discriminator, derive_pda, pack_string,
    TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
)

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
        election_pda = derive_pda(program_id, [b"election", bytes(admin_keypair.pubkey()), title.encode()])
        mint_pda = derive_pda(program_id, [b"mint", bytes(election_pda)])
        config_pda = derive_pda(program_id, [b"config", bytes(election_pda)])
        
        # 2. Pack Data
        # Discriminator + Title (String) + Start (i64) + End (i64)
        # <qq means "Little Endian, Signed Long Long (8 bytes)" x 2
        ix_data = get_discriminator("initialize_election") + pack_string(title) + struct.pack("<qq", start_ts, end_ts)
        
        # 3. Define Accounts (Must match lib.rs EXACTLY)
        accounts = [
            AccountMeta(pubkey=admin_keypair.pubkey(), is_signer=True, is_writable=True),
            AccountMeta(pubkey=election_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=config_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=mint_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=RENT, is_signer=False, is_writable=False),
        ]

        ix = []
        ix.append(Instruction(program_id, ix_data, accounts))

        for i, voter in enumerate(voters):
            ix.append(voter.register_voter(program_id, admin_keypair.pubkey(), voter.keypair.pubkey(), title, weights[i]))

        tx_signature = self.send_and_confirm(client, admin_keypair, ix)
        if not tx_signature:
            raise RuntimeError("InitializeElection transaction failed (no signature returned).")
        
        
    
        # 3. Create the link
        explorer_link = f"https://explorer.solana.com/tx/{tx_signature}?cluster=devnet"
        
        print(f"✅ Election Successfully Initialized!")
        print(f"🔗 Proof: {explorer_link}")


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
