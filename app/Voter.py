import struct
from solana.rpc.api import Client
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta
from solders.transaction import Transaction
from solders.message import Message
from solders.system_program import ID as SYS_PROGRAM_ID
from Candidate import Candidate
from utils import (
    get_discriminator, derive_pda, pack_string, get_associated_token_address,
    TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
)

class Voter():

    def __init__(self):
        self.keypair = Keypair()
        print(f"👤 New Voter Created: {str(self.keypair.pubkey())[:6]}...")

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
        
            print("🚀 Sending to blockchain...")
        
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
    
        # 1. Derive Election Address
        election_pda = derive_pda(program_id, [b"election", bytes(admin_pubkey), title.encode()])
        print(f"🔎 Looking for Election at: {election_pda}")

        # 2. Derive Mint Address
        mint_pda = derive_pda(program_id, [b"mint", bytes(election_pda)])
        config_pda = derive_pda(program_id, [b"config", bytes(election_pda)])
        voter_registry_pda = derive_pda(program_id, [b"voter_registry", bytes(election_pda), bytes(self.keypair.pubkey())])
        
        # 3. Derive Voter's Token Account
        voter_ata = get_associated_token_address(self.keypair.pubkey(), mint_pda, TOKEN_2022_PROGRAM_ID)
        
        ix_data = get_discriminator("cast_vote") + pack_string(candidate_obj.name)
        
        accounts = [
            AccountMeta(pubkey=self.keypair.pubkey(), is_signer=True, is_writable=True), # Voter (Signer)
            AccountMeta(pubkey=admin_pubkey, is_signer=False, is_writable=True),         # Fee Receiver (Admin)
            AccountMeta(pubkey=election_pda, is_signer=False, is_writable=True),         # Election
            AccountMeta(pubkey=config_pda, is_signer=False, is_writable=False),          # Election Config
            AccountMeta(pubkey=mint_pda, is_signer=False, is_writable=True),             # Mint
            AccountMeta(pubkey=voter_registry_pda, is_signer=False, is_writable=True),   # Voter Registry
            AccountMeta(pubkey=voter_ata, is_signer=False, is_writable=True),            # Token Account
            AccountMeta(pubkey=TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False), # Token Program
            AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),      # System Program
        ]
        
        return Instruction(program_id, ix_data, accounts)

    #Register to vote for the specific election on the blockchain.
    def register_voter(self, program_id, admin_pubkey, voter_pubkey, title, weight = 1):
        # Derive Addresses
        election_pda = derive_pda(program_id, [b"election", bytes(admin_pubkey), title.encode()])
        mint_pda = derive_pda(program_id, [b"mint", bytes(election_pda)])
        config_pda = derive_pda(program_id, [b"config", bytes(election_pda)])
        voter_registry_pda = derive_pda(program_id, [b"voter_registry", bytes(election_pda), bytes(voter_pubkey)])
        voter_ata = get_associated_token_address(voter_pubkey, mint_pda, TOKEN_2022_PROGRAM_ID)
        
        # Discriminator + Weight (1 vote)
        ix_data = get_discriminator("register_voter") + struct.pack("<Q", weight)

        accounts = [
            AccountMeta(pubkey=admin_pubkey, is_signer=True, is_writable=True),
            AccountMeta(pubkey=election_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=config_pda, is_signer=False, is_writable=False),
            AccountMeta(pubkey=mint_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=voter_pubkey, is_signer=False, is_writable=True), # Voter Wallet
            AccountMeta(pubkey=voter_registry_pda, is_signer=False, is_writable=True), # Voter Registry
            AccountMeta(pubkey=voter_ata, is_signer=False, is_writable=True),     # Voter Token Account
            AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=ASSOCIATED_TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
        ]
        return Instruction(program_id, ix_data, accounts)
        