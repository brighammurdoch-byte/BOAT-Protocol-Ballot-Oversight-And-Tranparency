import hashlib
import struct
from solders.pubkey import Pubkey

# Constants
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

def get_associated_token_address(owner: Pubkey, mint: Pubkey, token_program_id: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [bytes(owner), bytes(token_program_id), bytes(mint)],
        ASSOCIATED_TOKEN_PROGRAM_ID
    )[0]
