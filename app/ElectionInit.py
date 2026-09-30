import struct

from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.pubkey import Pubkey

from utils import (
    PROGRAM_ID, RENT_SYSVAR, SYS_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
    config_pda, election_pda, explorer, get_discriminator, mint_pda, outcome_pda,
    pack_string, send_and_confirm,
)


class ElectionInit:
    """Creates an election on-chain: initialize_election, then one add_outcome per candidate.

    Each step is its own transaction (mirrors the TypeScript demo and keeps every tx small).
    Voters are registered afterwards with Voter.register_voter(). Raises RuntimeError on failure.
    """

    def __init__(self, client, admin: Keypair, title: str, start_ts: int, end_ts: int, candidates, program_id: Pubkey = None):
        self.program_id = program_id or PROGRAM_ID
        self.client = client
        self.admin = admin
        self.title = title
        self.start_ts = start_ts
        self.end_ts = end_ts
        self.candidates = candidates

        self.election = election_pda(admin.pubkey(), title, self.program_id)
        self.config = config_pda(self.election, self.program_id)
        self.mint = mint_pda(self.election, self.program_id)

        self._initialize()
        for i, cand in enumerate(candidates):
            self._add_outcome(cand, i)

    # initialize_election(title: string, start_time: i64, end_time: i64)
    def _initialize(self):
        data = get_discriminator("initialize_election") + pack_string(self.title) + struct.pack("<qq", self.start_ts, self.end_ts)
        accounts = [  # order = IDL: authority, election, election_config, sbt_mint, system_program, token_program, rent
            AccountMeta(self.admin.pubkey(), True, True),
            AccountMeta(self.election, False, True),
            AccountMeta(self.config, False, True),
            AccountMeta(self.mint, False, True),
            AccountMeta(SYS_PROGRAM_ID, False, False),
            AccountMeta(TOKEN_2022_PROGRAM_ID, False, False),
            AccountMeta(RENT_SYSVAR, False, False),
        ]
        sig = send_and_confirm(self.client, [Instruction(self.program_id, data, accounts)], [self.admin], self.admin,
                               label="initialize_election")
        if not sig:
            raise RuntimeError("initialize_election failed (see message above).")
        print("✅ Election created (Election + ElectionConfig + Token-2022 SBT mint PDAs)")
        print(f"   Election PDA : {self.election}")
        print(f"   SBT mint PDA : {self.mint}")
        print(f"🔗 {explorer(sig)}")

    # add_outcome(label: string, outcome_index: u8) — indexes must be added in order 0,1,2,... before start_time
    def _add_outcome(self, cand, index: int):
        cand.index = index
        outcome = outcome_pda(self.election, index, self.program_id)
        data = get_discriminator("add_outcome") + pack_string(cand.name) + struct.pack("<B", index)
        accounts = [  # authority, election, outcome, system_program
            AccountMeta(self.admin.pubkey(), True, True),
            AccountMeta(self.election, False, True),
            AccountMeta(outcome, False, True),
            AccountMeta(SYS_PROGRAM_ID, False, False),
        ]
        sig = send_and_confirm(self.client, [Instruction(self.program_id, data, accounts)], [self.admin], self.admin,
                               label=f"add_outcome[{index}]")
        if not sig:
            raise RuntimeError(f"add_outcome failed for candidate #{index} '{cand.name}'. "
                               "Outcomes must be added before the election start time.")
        print(f"   ➕ Outcome {index}: {cand.name}")
