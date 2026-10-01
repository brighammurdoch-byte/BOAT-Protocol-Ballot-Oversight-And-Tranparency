"""Integration tests that hit the deployed BOAT program directly (default: devnet). No front end, no ZK.

Run:  python -m unittest contract_unit_tests -v      (from the app/ folder)
Env:  BOAT_RPC_URL, BOAT_PROGRAM_ID, BOAT_ADMIN_KEYPAIR (see utils.py). Needs ~0.1 SOL on the admin wallet.

Removed from the program (tests dropped): enable_token_voting / cast_vote_with_token.
The IDL now exposes: initialize_election, set_election_config, add_outcome, register_voter, cast_vote,
delegate_vote (+ ZK/private-ballot instructions, which are intentionally not covered here).
"""
import struct
import time
import unittest

from solana.rpc.api import Client
from solana.rpc.commitment import Confirmed
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair

from Candidate import Candidate
from ElectionInit import ElectionInit
from Voter import Voter
import utils
from utils import (
    PROGRAM_ID, RPC_URL, config_pda, ensure_funds, fetch_election, get_admin_keypair, get_discriminator,
    send_and_confirm, tally_from_chain, voter_registry_pda, wait_for_cluster_time, cluster_time,
)

START_DELAY = 20


class BoatContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = Client(RPC_URL, commitment=Confirmed)
        cls.admin = get_admin_keypair()
        if not ensure_funds(cls.client, cls.admin.pubkey(), min_sol=0.1):
            raise unittest.SkipTest("admin wallet not funded")

    def new_election(self, register=1, start_delay=START_DELAY):
        title = f"UnitTest_{int(time.time() * 1000)}"
        start = cluster_time(self.client) + start_delay
        cands = [Candidate("Alice"), Candidate("Bob")]
        init = ElectionInit(self.client, self.admin, title, start, start + 600, cands)
        voters = [Voter() for _ in range(register)]
        for v in voters:
            sig = v.send_and_confirm(self.client, v.register_voter(self.admin.pubkey(), title, 1), self.admin, self.admin, "register")
            self.assertTrue(sig)
        return title, start, init, cands, voters

    def cast(self, voter, cand, title):
        return voter.send_and_confirm(self.client, voter.cast_vote(self.admin.pubkey(), cand, title), voter.keypair, self.admin, "cast")

    def test_01_initialize_and_outcomes(self):
        title, start, init, cands, _ = self.new_election(register=0)
        el = fetch_election(self.client, init.election)
        self.assertEqual(el.title, title)
        self.assertEqual(el.outcome_count, 2)

    def test_02_set_election_config(self):
        title = f"UnitTestCfg_{int(time.time() * 1000)}"
        start = cluster_time(self.client) + 60
        init = ElectionInit(self.client, self.admin, title, start, start + 600, [Candidate("A")])
        data = (get_discriminator("set_election_config") + struct.pack("<Q", 2) + struct.pack("<B", 40)
                + struct.pack("<B", 2) + struct.pack("<Q", 0) + struct.pack("<?", True))
        ix = Instruction(PROGRAM_ID, data, [
            AccountMeta(self.admin.pubkey(), True, False),
            AccountMeta(init.election, False, False),
            AccountMeta(config_pda(init.election), False, True),
        ])
        self.assertTrue(send_and_confirm(self.client, [ix], [self.admin], self.admin, label="set_election_config"))

    def test_03_register_vote_change_and_tally(self):
        title, start, init, (alice, bob), (voter,) = self.new_election()
        wait_for_cluster_time(self.client, start + 2)
        self.assertTrue(self.cast(voter, alice, title))
        _, _, tally, _ = tally_from_chain(self.client, init.election, [voter.pubkey])
        self.assertEqual(tally, {"Alice": 1, "Bob": 0})
        self.assertTrue(self.cast(voter, bob, title))  # change vote (default max_free_vote_changes = 2; the cap only bites when price_per_vote_change > 0)
        _, _, tally, regs = tally_from_chain(self.client, init.election, [voter.pubkey])
        self.assertEqual(tally, {"Alice": 0, "Bob": 1})
        self.assertEqual(regs[0].vote_changes_used, 1)

    def test_04_unregistered_voter_cannot_vote(self):
        title, start, init, (alice, _), _ = self.new_election(register=0)
        wait_for_cluster_time(self.client, start + 2)
        stranger = Voter()
        # fund-less stranger: the admin pays fees; the transaction must fail because there is no registry/token account
        sig = self.cast(stranger, alice, title)
        self.assertIsNone(sig)
        self.assertIn("AccountNotInitialized", utils.LAST_ERROR)  # not just "some failure" (RPC hiccup, etc.)

    def test_05_delegate_vote_blocks_direct_vote(self):
        title = f"UnitTestDel_{int(time.time() * 1000)}"
        start = cluster_time(self.client) + START_DELAY
        init = ElectionInit(self.client, self.admin, title, start, start + 600, [Candidate("Alice"), Candidate("Bob")])
        cfg = (get_discriminator("set_election_config") + struct.pack("<Q", 1) + struct.pack("<B", 40)
               + struct.pack("<B", 2) + struct.pack("<Q", 0) + struct.pack("<?", True))  # allow_delegation = True
        send_and_confirm(self.client, [Instruction(PROGRAM_ID, cfg, [
            AccountMeta(self.admin.pubkey(), True, False), AccountMeta(init.election, False, False),
            AccountMeta(config_pda(init.election), False, True)])], [self.admin], self.admin, label="set_election_config")
        a, b = Voter(), Voter()
        for v in (a, b):
            self.assertTrue(v.send_and_confirm(self.client, v.register_voter(self.admin.pubkey(), title, 1), self.admin, self.admin, "register"))
        delegate = Instruction(PROGRAM_ID, get_discriminator("delegate_vote"), [
            AccountMeta(a.pubkey, True, False),
            AccountMeta(init.election, False, False),
            AccountMeta(config_pda(init.election), False, False),
            AccountMeta(voter_registry_pda(init.election, a.pubkey), False, True),
            AccountMeta(voter_registry_pda(init.election, b.pubkey), False, False),
        ])
        self.assertTrue(send_and_confirm(self.client, [delegate], [self.admin, a.keypair], self.admin, label="delegate_vote"))
        wait_for_cluster_time(self.client, start + 2)
        self.assertIsNone(self.cast(a, init.candidates[0], title))
        self.assertIn("CannotVoteIfDelegated", utils.LAST_ERROR)


if __name__ == "__main__":
    unittest.main(verbosity=2)
