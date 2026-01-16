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
from Candidate import Candidate

TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
ASSOCIATED_TOKEN_PROGRAM_ID = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")

class Voter():

    def __init__(self):
        self.keypair = Keypair()
        print(print(f"👤 New Voter Created: {str(self.keypair.pubkey())[:6]}..."))

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

    def send_and_confirm(self, client, instructions, signer_keypair, payer_keypair):
        
        """
    Signs and sends a transaction with a separate Fee Payer.
    
    Args:
        client: Solana RPC Client
        instruction: The instruction to execute
        signer_keypair: The Voter (authorizes the vote)
        payer_keypair: The Admin (pays the gas fee)
    """

        try:
            payer_pubkey = payer_keypair.pubkey()        
            latest_blockhash = client.get_latest_blockhash().value.blockhash
            msg = Message([instructions], payer_pubkey)
            
            tx = Transaction([payer_keypair, signer_keypair], msg, latest_blockhash)
        
            print("🚀 Sending vote to blockchain...")
        
            signature = client.send_transaction(tx)
            print(f"✅ Success! Tx: https://explorer.solana.com/tx/{signature.value}?cluster=devnet")
            return signature.value
        except Exception as e:
            print(f"❌ Error: {e}")
            return None

    #Cast a vote to the blockchain
    def cast_vote(self, program_id, admin_pubkey, candidate_obj, title):

        # TYPE CHECK: Ensure we are voting for a real Candidate object
        if not isinstance(candidate_obj, Candidate):
            print("❌ Error: You must vote for a valid Candidate object!")
            return
    
        # ⚠️ FIX: We must use the ADMIN'S Key for the seed, not the Voter's!
        # Even if they are the same person right now, this makes the math robust.
        admin_pubkey = Pubkey.from_string("FEjpVrjwoXm2VXvUkf1NNLtcyfpw2wjzL2NatmoVZ8Lo")

        # 1. Derive Election Address
        election_pda = self.derive_pda(program_id, [b"election", bytes(admin_pubkey), title.encode()])
        print(f"🔎 Looking for Election at: {election_pda}")

        # 2. Derive Mint Address
        mint_pda = self.derive_pda(program_id, [b"mint", bytes(election_pda)])
        
        # 3. Derive Voter's Token Account
        voter_ata = get_associated_token_address(self.keypair.pubkey(), mint_pda, TOKEN_2022_PROGRAM_ID)
        
        ix_data = self.get_discriminator("cast_vote") + self.pack_string(candidate_obj.name)
        
        accounts = [
            AccountMeta(pubkey=admin_pubkey, is_signer=True, is_writable=True),
            AccountMeta(pubkey=self.keypair.pubkey(), is_signer=True, is_writable=True),
            AccountMeta(pubkey=election_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=mint_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=voter_ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
        ]
        
        return Instruction(program_id, ix_data, accounts)

    #Register to vote for the specific election on the blockchain.
    def register_voter(self, program_id, admin_pubkey, voter_pubkey, title, weight = 1):
        # Derive Addresses
        election_pda = self.derive_pda(program_id, [b"election", bytes(admin_pubkey), title.encode()])
        mint_pda = self.derive_pda(program_id, [b"mint", bytes(election_pda)])
        voter_ata = get_associated_token_address(self.keypair.pubkey(), mint_pda, TOKEN_2022_PROGRAM_ID)
        
        # Discriminator + Weight (1 vote)
        ix_data = self.get_discriminator("register_voter") + struct.pack("<Q", weight)

        accounts = [
            AccountMeta(pubkey=admin_pubkey, is_signer=True, is_writable=True),
            AccountMeta(pubkey=election_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=mint_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=voter_pubkey, is_signer=False, is_writable=True), # Voter Wallet
            AccountMeta(pubkey=voter_ata, is_signer=False, is_writable=True),     # Voter Token Account
            AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=ASSOCIATED_TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
        ]
        return Instruction(program_id, ix_data, accounts)
        