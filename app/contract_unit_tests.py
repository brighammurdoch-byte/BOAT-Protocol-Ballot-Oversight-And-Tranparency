import os
import json
import time
import struct
import unittest

from solana.rpc.api import Client
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.instruction import Instruction, AccountMeta
from solders.message import Message
from solders.transaction import Transaction
from solders.system_program import ID as SYS_PROGRAM_ID

from utils import get_discriminator, derive_pda, pack_string, get_associated_token_address, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID


PROGRAM_ID = Pubkey.from_string("5ZvG5oXKD6YKgWkAKWQMjdAb3vXEWzRNNGk3uRSt63gP")
ADMIN_KEY_FILE = os.path.join(os.path.dirname(__file__), "admin.json")


def load_admin() -> Keypair:
    with open(ADMIN_KEY_FILE, "r") as f:
        secret = json.load(f)
    return Keypair.from_bytes(secret)


def send_and_confirm(client: Client, payer: Keypair, instructions, additional_signers=None):
    if additional_signers is None:
        additional_signers = []
    latest_blockhash = client.get_latest_blockhash().value.blockhash
    msg = Message(instructions, payer.pubkey())
    tx = Transaction([payer, *additional_signers], msg, latest_blockhash)
    sig = client.send_transaction(tx).value
    # Devnet can be a bit laggy; poll until confirmed/finalized so subsequent instructions
    # don't hit AccountNotInitialized due to timing.
    for _ in range(30):
        try:
            st = client.get_signature_statuses([sig]).value[0]
            if st and st.confirmation_status in ("confirmed", "finalized") and st.err is None:
                return sig
        except Exception:
            pass
        time.sleep(1)
    return sig


def must_fail(fn, contains: str):
    try:
        fn()
    except Exception as e:
        s = str(e)
        if contains and contains not in s:
            raise AssertionError(f"Expected error containing '{contains}', got: {s}") from e
        return
    raise AssertionError("Expected transaction to fail, but it succeeded")


class BoatContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = Client("https://api.devnet.solana.com", commitment="confirmed")
        cls.admin = load_admin()

    def setUp(self):
        ts = int(time.time())
        self.title = f"UnitTest_{ts}"
        self.start_time = ts - 2
        self.end_time = ts + 600

        self.election_pda = derive_pda(PROGRAM_ID, [b"election", bytes(self.admin.pubkey()), self.title.encode()])
        self.config_pda = derive_pda(PROGRAM_ID, [b"config", bytes(self.election_pda)])
        self.sbt_mint_pda = derive_pda(PROGRAM_ID, [b"mint", bytes(self.election_pda)])

    def test_01_initialize_election(self):
        ix_data = (
            get_discriminator("initialize_election")
            + pack_string(self.title)
            + struct.pack("<qq", self.start_time, self.end_time)
        )
        ix = Instruction(
            PROGRAM_ID,
            ix_data,
            [
                AccountMeta(self.admin.pubkey(), is_signer=True, is_writable=True),
                AccountMeta(self.election_pda, is_signer=False, is_writable=True),
                AccountMeta(self.config_pda, is_signer=False, is_writable=True),
                AccountMeta(self.sbt_mint_pda, is_signer=False, is_writable=True),
                AccountMeta(SYS_PROGRAM_ID, is_signer=False, is_writable=False),
                AccountMeta(TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
                AccountMeta(Pubkey.from_string("SysvarRent111111111111111111111111111111111"), is_signer=False, is_writable=False),
            ],
        )
        sig = send_and_confirm(self.client, self.admin, [ix])
        self.assertTrue(sig)

    def test_02_set_election_config(self):
        self.test_01_initialize_election()

        ix_data = (
            get_discriminator("set_election_config")
            + struct.pack("<Q", 2)      # default_voter_weight
            + struct.pack("<B", 40)     # quorum_percentage
            + struct.pack("<B", 2)      # max_free_vote_changes
            + struct.pack("<Q", 0)      # price_per_vote_change
            + struct.pack("<?", True)   # allow_delegation
        )
        ix = Instruction(
            PROGRAM_ID,
            ix_data,
            [
                AccountMeta(self.admin.pubkey(), is_signer=True, is_writable=True),
                AccountMeta(self.election_pda, is_signer=False, is_writable=False),
                AccountMeta(self.config_pda, is_signer=False, is_writable=True),
            ],
        )
        sig = send_and_confirm(self.client, self.admin, [ix])
        self.assertTrue(sig)

    def test_03_register_and_cast_vote_and_change(self):
        self.test_01_initialize_election()

        voter = Keypair()
        voter_registry = derive_pda(PROGRAM_ID, [b"voter_registry", bytes(self.election_pda), bytes(voter.pubkey())])
        voter_ata = get_associated_token_address(voter.pubkey(), self.sbt_mint_pda, TOKEN_2022_PROGRAM_ID)

        reg_ix = Instruction(
            PROGRAM_ID,
            get_discriminator("register_voter") + struct.pack("<Q", 1),
            [
                AccountMeta(self.admin.pubkey(), is_signer=True, is_writable=True),
                AccountMeta(self.election_pda, is_signer=False, is_writable=True),
                AccountMeta(self.config_pda, is_signer=False, is_writable=False),
                AccountMeta(self.sbt_mint_pda, is_signer=False, is_writable=True),
                AccountMeta(voter.pubkey(), is_signer=False, is_writable=True),
                AccountMeta(voter_registry, is_signer=False, is_writable=True),
                AccountMeta(voter_ata, is_signer=False, is_writable=True),
                AccountMeta(SYS_PROGRAM_ID, is_signer=False, is_writable=False),
                AccountMeta(TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
                AccountMeta(ASSOCIATED_TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
            ],
        )
        sig = send_and_confirm(self.client, self.admin, [reg_ix])
        self.assertTrue(sig)

        cast_ix = Instruction(
            PROGRAM_ID,
            get_discriminator("cast_vote") + pack_string("Alice"),
            [
                AccountMeta(voter.pubkey(), is_signer=True, is_writable=True),
                AccountMeta(self.admin.pubkey(), is_signer=False, is_writable=True),
                AccountMeta(self.election_pda, is_signer=False, is_writable=True),
                AccountMeta(self.config_pda, is_signer=False, is_writable=False),
                AccountMeta(self.sbt_mint_pda, is_signer=False, is_writable=True),
                AccountMeta(voter_registry, is_signer=False, is_writable=True),
                AccountMeta(voter_ata, is_signer=False, is_writable=True),
                AccountMeta(TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
                AccountMeta(SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            ],
        )
        sig2 = send_and_confirm(self.client, self.admin, [cast_ix], additional_signers=[voter])
        self.assertTrue(sig2)

        # Vote change should succeed (default max_free_vote_changes = 2)
        cast2_ix = Instruction(
            PROGRAM_ID,
            get_discriminator("cast_vote") + pack_string("Bob"),
            cast_ix.accounts,
        )
        sig3 = send_and_confirm(self.client, self.admin, [cast2_ix], additional_signers=[voter])
        self.assertTrue(sig3)

    def test_04_delegate_vote_blocks_direct_vote(self):
        self.test_01_initialize_election()

        voter_a = Keypair()
        voter_b = Keypair()

        def reg(voter: Keypair):
            voter_registry = derive_pda(PROGRAM_ID, [b"voter_registry", bytes(self.election_pda), bytes(voter.pubkey())])
            voter_ata = get_associated_token_address(voter.pubkey(), self.sbt_mint_pda, TOKEN_2022_PROGRAM_ID)
            ix = Instruction(
                PROGRAM_ID,
                get_discriminator("register_voter") + struct.pack("<Q", 1),
                [
                    AccountMeta(self.admin.pubkey(), is_signer=True, is_writable=True),
                    AccountMeta(self.election_pda, is_signer=False, is_writable=True),
                    AccountMeta(self.config_pda, is_signer=False, is_writable=False),
                    AccountMeta(self.sbt_mint_pda, is_signer=False, is_writable=True),
                    AccountMeta(voter.pubkey(), is_signer=False, is_writable=True),
                    AccountMeta(voter_registry, is_signer=False, is_writable=True),
                    AccountMeta(voter_ata, is_signer=False, is_writable=True),
                    AccountMeta(SYS_PROGRAM_ID, is_signer=False, is_writable=False),
                    AccountMeta(TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
                    AccountMeta(ASSOCIATED_TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
                ],
            )
            send_and_confirm(self.client, self.admin, [ix])
            return voter_registry, voter_ata

        a_registry, a_ata = reg(voter_a)
        b_registry, _ = reg(voter_b)

        delegate_ix = Instruction(
            PROGRAM_ID,
            get_discriminator("delegate_vote"),
            [
                AccountMeta(voter_a.pubkey(), is_signer=True, is_writable=True),
                AccountMeta(self.election_pda, is_signer=False, is_writable=False),
                AccountMeta(self.config_pda, is_signer=False, is_writable=False),
                AccountMeta(a_registry, is_signer=False, is_writable=True),
                AccountMeta(b_registry, is_signer=False, is_writable=False),
            ],
        )
        sig = send_and_confirm(self.client, self.admin, [delegate_ix], additional_signers=[voter_a])
        self.assertTrue(sig)

        def try_cast():
            cast_ix = Instruction(
                PROGRAM_ID,
                get_discriminator("cast_vote") + pack_string("Alice"),
                [
                    AccountMeta(voter_a.pubkey(), is_signer=True, is_writable=True),
                    AccountMeta(self.admin.pubkey(), is_signer=False, is_writable=True),
                    AccountMeta(self.election_pda, is_signer=False, is_writable=True),
                    AccountMeta(self.config_pda, is_signer=False, is_writable=False),
                    AccountMeta(self.sbt_mint_pda, is_signer=False, is_writable=True),
                    AccountMeta(a_registry, is_signer=False, is_writable=True),
                    AccountMeta(a_ata, is_signer=False, is_writable=True),
                    AccountMeta(TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
                    AccountMeta(SYS_PROGRAM_ID, is_signer=False, is_writable=False),
                ],
            )
            send_and_confirm(self.client, self.admin, [cast_ix], additional_signers=[voter_a])

        must_fail(try_cast, "CannotVoteIfDelegated")

    def test_05_enable_token_voting_and_cast_with_sbt(self):
        # Use the election's own SBT mint as the "governance token" for token voting.
        self.test_01_initialize_election()

        # Set min_token_balance = 2 to force a failure for a weight-1 voter
        enable_ix = Instruction(
            PROGRAM_ID,
            get_discriminator("enable_token_voting") + struct.pack("<Q", 2),
            [
                AccountMeta(self.admin.pubkey(), is_signer=True, is_writable=True),
                AccountMeta(self.election_pda, is_signer=False, is_writable=False),
                AccountMeta(self.config_pda, is_signer=False, is_writable=True),
                AccountMeta(self.sbt_mint_pda, is_signer=False, is_writable=False),
                AccountMeta(SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            ],
        )
        send_and_confirm(self.client, self.admin, [enable_ix])

        voter = Keypair()
        voter_registry = derive_pda(PROGRAM_ID, [b"voter_registry", bytes(self.election_pda), bytes(voter.pubkey())])
        voter_ata = get_associated_token_address(voter.pubkey(), self.sbt_mint_pda, TOKEN_2022_PROGRAM_ID)
        reg_ix = Instruction(
            PROGRAM_ID,
            get_discriminator("register_voter") + struct.pack("<Q", 1),
            [
                AccountMeta(self.admin.pubkey(), is_signer=True, is_writable=True),
                AccountMeta(self.election_pda, is_signer=False, is_writable=True),
                AccountMeta(self.config_pda, is_signer=False, is_writable=False),
                AccountMeta(self.sbt_mint_pda, is_signer=False, is_writable=True),
                AccountMeta(voter.pubkey(), is_signer=False, is_writable=True),
                AccountMeta(voter_registry, is_signer=False, is_writable=True),
                AccountMeta(voter_ata, is_signer=False, is_writable=True),
                AccountMeta(SYS_PROGRAM_ID, is_signer=False, is_writable=False),
                AccountMeta(TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
                AccountMeta(ASSOCIATED_TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
            ],
        )
        send_and_confirm(self.client, self.admin, [reg_ix])

        def cast_should_fail():
            ix = Instruction(
                PROGRAM_ID,
                get_discriminator("cast_vote_with_token") + pack_string("Alice"),
                [
                    AccountMeta(voter.pubkey(), is_signer=True, is_writable=True),
                    AccountMeta(self.election_pda, is_signer=False, is_writable=False),
                    AccountMeta(self.config_pda, is_signer=False, is_writable=False),
                    AccountMeta(voter_ata, is_signer=False, is_writable=False),
                    AccountMeta(self.sbt_mint_pda, is_signer=False, is_writable=False),
                    AccountMeta(TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
                ],
            )
            send_and_confirm(self.client, self.admin, [ix], additional_signers=[voter])

        must_fail(cast_should_fail, "InsufficientTokenBalance")

        # Now reduce min_token_balance to 1 and vote should succeed.
        enable_ix2 = Instruction(
            PROGRAM_ID,
            get_discriminator("enable_token_voting") + struct.pack("<Q", 1),
            [
                AccountMeta(self.admin.pubkey(), is_signer=True, is_writable=True),
                AccountMeta(self.election_pda, is_signer=False, is_writable=False),
                AccountMeta(self.config_pda, is_signer=False, is_writable=True),
                AccountMeta(self.sbt_mint_pda, is_signer=False, is_writable=False),
                AccountMeta(SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            ],
        )
        send_and_confirm(self.client, self.admin, [enable_ix2])

        ix_ok = Instruction(
            PROGRAM_ID,
            get_discriminator("cast_vote_with_token") + pack_string("Alice"),
            [
                AccountMeta(voter.pubkey(), is_signer=True, is_writable=True),
                AccountMeta(self.election_pda, is_signer=False, is_writable=False),
                AccountMeta(self.config_pda, is_signer=False, is_writable=False),
                AccountMeta(voter_ata, is_signer=False, is_writable=False),
                AccountMeta(self.sbt_mint_pda, is_signer=False, is_writable=False),
                AccountMeta(TOKEN_2022_PROGRAM_ID, is_signer=False, is_writable=False),
            ],
        )
        sig = send_and_confirm(self.client, self.admin, [ix_ok], additional_signers=[voter])
        self.assertTrue(sig)


if __name__ == "__main__":
    unittest.main(verbosity=2)

