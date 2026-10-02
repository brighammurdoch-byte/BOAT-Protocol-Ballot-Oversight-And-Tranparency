import struct

from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.pubkey import Pubkey

from Candidate import Candidate
from utils import (
    ASSOCIATED_TOKEN_PROGRAM_ID, PROGRAM_ID, SYS_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
    config_pda, election_pda, explorer, get_associated_token_address, get_discriminator,
    mint_pda, outcome_pda, send_and_confirm, voter_registry_pda,
)


class Voter:
    """One voter wallet. The admin registers it (mints the soulbound Token-2022 token); the voter signs votes."""

    def __init__(self, program_id: Pubkey = None):
        self.keypair = Keypair()
        self.program_id = program_id or PROGRAM_ID
        print(f"👤 New Voter Created: {str(self.keypair.pubkey())[:6]}…")

    @property
    def pubkey(self) -> Pubkey:
        return self.keypair.pubkey()

    # ---- register_voter(weight: u64) — signed by the election authority ----
    def register_voter(self, admin_pubkey: Pubkey, title: str, weight: int = 1) -> Instruction:
        election = election_pda(admin_pubkey, title, self.program_id)
        mint = mint_pda(election, self.program_id)
        accounts = [  # authority, election, election_config, sbt_mint, voter, voter_registry, voter_token_account,
                      # system_program, token_program, associated_token_program
            AccountMeta(admin_pubkey, True, True),
            AccountMeta(election, False, True),
            AccountMeta(config_pda(election, self.program_id), False, False),
            AccountMeta(mint, False, True),
            AccountMeta(self.pubkey, False, False),
            AccountMeta(voter_registry_pda(election, self.pubkey, self.program_id), False, True),
            AccountMeta(get_associated_token_address(self.pubkey, mint, TOKEN_2022_PROGRAM_ID), False, True),
            AccountMeta(SYS_PROGRAM_ID, False, False),
            AccountMeta(TOKEN_2022_PROGRAM_ID, False, False),
            AccountMeta(ASSOCIATED_TOKEN_PROGRAM_ID, False, False),
        ]
        return Instruction(self.program_id, get_discriminator("register_voter") + struct.pack("<Q", weight), accounts)

    # ---- cast_vote(outcome_index: u8) — signed by the voter (also used to CHANGE a vote: just call again) ----
    def cast_vote(
        self, admin_pubkey: Pubkey, candidate: Candidate, title: str, fee_receiver: Pubkey | None = None
    ) -> Instruction:
        if not isinstance(candidate, Candidate) or candidate.index is None:
            raise ValueError("cast_vote needs a Candidate that was added on-chain (candidate.index is set by ElectionInit).")
        election = election_pda(admin_pubkey, title, self.program_id)
        mint = mint_pda(election, self.program_id)
        # fee_receiver must be the election authority. Anything else is rejected on-chain
        # (InvalidFeeReceiver), including the voter's own wallet.
        receiver = fee_receiver or admin_pubkey
        accounts = [  # voter, fee_receiver, election, election_config, private_config(optional), sbt_mint,
                      # voter_registry, voter_token_account, outcome, token_program, system_program
            AccountMeta(self.pubkey, True, True),
            AccountMeta(receiver, False, True),
            AccountMeta(election, False, False),
            AccountMeta(config_pda(election, self.program_id), False, False),
            AccountMeta(self.program_id, False, False),  # Anchor convention: optional account = None → pass program ID
            AccountMeta(mint, False, False),
            AccountMeta(voter_registry_pda(election, self.pubkey, self.program_id), False, True),
            AccountMeta(get_associated_token_address(self.pubkey, mint, TOKEN_2022_PROGRAM_ID), False, False),
            AccountMeta(outcome_pda(election, candidate.index, self.program_id), False, False),
            AccountMeta(TOKEN_2022_PROGRAM_ID, False, False),
            AccountMeta(SYS_PROGRAM_ID, False, False),
        ]
        return Instruction(self.program_id, get_discriminator("cast_vote") + struct.pack("<B", candidate.index), accounts)

    def send_and_confirm(self, client, instruction, signer_keypair, payer_keypair, label: str = ""):
        """Send one instruction; `payer_keypair` pays fees (the admin, in this demo), `signer_keypair` authorizes."""
        signers = [payer_keypair] if signer_keypair.pubkey() == payer_keypair.pubkey() else [payer_keypair, signer_keypair]
        sig = send_and_confirm(client, [instruction], signers, payer_keypair, label=label)
        if sig:
            print(f"   ✅ {label or 'tx'}: {explorer(sig)}")
        return sig
