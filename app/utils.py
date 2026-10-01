"""Shared helpers for the BOAT Python demos (talk straight to the Solana program, no front end).

Everything here is derived from the current Anchor IDL (packages/boat-sdk/src/idl/boat_final.json),
so instruction discriminators, error names and account layouts stay in sync with the deployed program.

Environment variables (all optional):
  BOAT_RPC_URL          RPC endpoint            (default: https://api.devnet.solana.com)
  BOAT_PROGRAM_ID       Program ID override     (default: the IDL address / current devnet deployment)
  BOAT_ADMIN_KEYPAIR    Path to admin keypair JSON (falls back to SOLANA_KEYPAIR, then app/admin.json,
                        then an auto-generated throwaway key stored in app/.demo_admin.json)
"""
import json
import os
import struct
import sys
import time
from dataclasses import dataclass
from typing import List, Optional

from solana.rpc.api import Client
from solana.rpc.commitment import Confirmed
from solana.rpc.types import MemcmpOpts, TxOpts
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.system_program import ID as SYS_PROGRAM_ID
from solders.transaction import Transaction

APP_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(APP_DIR)
IDL_PATHS = [
    os.path.join(REPO_ROOT, "target", "idl", "boat_final.json"),
    os.path.join(REPO_ROOT, "packages", "boat-sdk", "src", "idl", "boat_final.json"),
]

TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
ASSOCIATED_TOKEN_PROGRAM_ID = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
RENT_SYSVAR = Pubkey.from_string("SysvarRent111111111111111111111111111111111")

DEFAULT_RPC_URL = "https://api.devnet.solana.com"
# Current devnet deployment (kept as a fallback if the IDL cannot be read).
FALLBACK_PROGRAM_ID = "DgVtAKNDKiTYUowPBsXfDnv7Seq5hE3NsP1oMDexCoid"
GENERATED_KEY_FILE = os.path.join(APP_DIR, ".demo_admin.json")


# --------------------------------------------------------------------------- IDL
def load_idl() -> dict:
    for p in IDL_PATHS:
        if os.path.exists(p):
            with open(p, "r") as f:
                return json.load(f)
    raise FileNotFoundError(
        "Could not find the BOAT IDL. Looked in:\n  " + "\n  ".join(IDL_PATHS) +
        "\nRun the demo from a full checkout of the repo (the IDL lives in packages/boat-sdk/src/idl/)."
    )


IDL = load_idl()
_IX = {i["name"]: i for i in IDL["instructions"]}
_ACCT_DISC = {a["name"]: bytes(a["discriminator"]) for a in IDL["accounts"]}
_ERRORS = {e["code"]: e for e in IDL.get("errors", [])}

RPC_URL = os.environ.get("BOAT_RPC_URL", DEFAULT_RPC_URL)
PROGRAM_ID = Pubkey.from_string(os.environ.get("BOAT_PROGRAM_ID") or IDL.get("address") or FALLBACK_PROGRAM_ID)


def get_discriminator(name: str) -> bytes:
    """8-byte Anchor instruction discriminator, straight from the IDL (snake_case name)."""
    if name not in _IX:
        raise KeyError(f"Instruction '{name}' is not in the current IDL (removed from the program?). "
                       f"Available: {sorted(_IX)}")
    return bytes(_IX[name]["discriminator"])


def account_discriminator(name: str) -> bytes:
    return _ACCT_DISC[name]


def error_name(code: int) -> Optional[str]:
    e = _ERRORS.get(code)
    return f"{e['name']}: {e.get('msg', '')}" if e else None


def describe_error(exc: Exception) -> str:
    """Turn an RPC/preflight error into readable text, adding the program's named error when present."""
    s = str(exc) or repr(exc)
    import re
    m = re.search(r"custom program error: 0x([0-9a-fA-F]+)", s) or re.search(r'"Custom":\s*(\d+)', s)
    named = ""
    if m:
        code = int(m.group(1), 16) if "0x" in m.group(0) else int(m.group(1))
        n = error_name(code)
        if n:
            named = f" [{n}]"
    return s[:600] + named


# --------------------------------------------------------------------------- PDAs / encoding
def derive_pda(program_id: Pubkey, seeds: List[bytes]) -> Pubkey:
    return Pubkey.find_program_address(seeds, program_id)[0]


def election_pda(admin: Pubkey, title: str, program_id: Pubkey = None) -> Pubkey:
    return derive_pda(program_id or PROGRAM_ID, [b"election", bytes(admin), title.encode()])


def config_pda(election: Pubkey, program_id: Pubkey = None) -> Pubkey:
    return derive_pda(program_id or PROGRAM_ID, [b"config", bytes(election)])


def mint_pda(election: Pubkey, program_id: Pubkey = None) -> Pubkey:
    return derive_pda(program_id or PROGRAM_ID, [b"mint", bytes(election)])


def outcome_pda(election: Pubkey, index: int, program_id: Pubkey = None) -> Pubkey:
    return derive_pda(program_id or PROGRAM_ID, [b"outcome", bytes(election), bytes([index])])


def voter_registry_pda(election: Pubkey, voter: Pubkey, program_id: Pubkey = None) -> Pubkey:
    return derive_pda(program_id or PROGRAM_ID, [b"voter_registry", bytes(election), bytes(voter)])


def pack_string(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack("<I", len(b)) + b


def get_associated_token_address(owner: Pubkey, mint: Pubkey, token_program_id: Pubkey = TOKEN_2022_PROGRAM_ID) -> Pubkey:
    return Pubkey.find_program_address(
        [bytes(owner), bytes(token_program_id), bytes(mint)], ASSOCIATED_TOKEN_PROGRAM_ID
    )[0]


# --------------------------------------------------------------------------- keys & funds
def load_keypair_file(path: str) -> Keypair:
    with open(path, "r") as f:
        return Keypair.from_bytes(bytes(json.load(f)))


def get_admin_keypair() -> Keypair:
    """Load the admin/authority wallet, or create a throwaway one (never a real wallet by accident)."""
    for env in ("BOAT_ADMIN_KEYPAIR", "SOLANA_KEYPAIR"):
        p = os.environ.get(env)
        if p:
            if not os.path.exists(p):
                sys.exit(f"❌ {env} points to '{p}', which does not exist. "
                         f"Unset it to auto-generate a throwaway demo wallet, or fix the path.")
            try:
                kp = load_keypair_file(p)
            except Exception as e:
                sys.exit(f"❌ Could not read keypair '{p}' from {env} ({e}). Expected a JSON array of 64 bytes.")
            print(f"🔑 Admin keypair loaded from ${env}")
            return kp
    legacy = os.path.join(APP_DIR, "admin.json")
    if os.path.exists(legacy):
        try:
            print(f"🔑 Admin keypair loaded from {legacy}")
            return load_keypair_file(legacy)
        except Exception as e:
            sys.exit(f"❌ Could not read {legacy} ({e}). Delete it or set BOAT_ADMIN_KEYPAIR.")
    if os.path.exists(GENERATED_KEY_FILE):
        print(f"🔑 Reusing throwaway demo admin wallet {GENERATED_KEY_FILE}")
        return load_keypair_file(GENERATED_KEY_FILE)
    kp = Keypair()
    fd = os.open(GENERATED_KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(list(bytes(kp)), f)
    print(f"🔑 No admin keypair configured → generated a throwaway wallet at {GENERATED_KEY_FILE}")
    return kp


def get_balance_sol(client: Client, pubkey: Pubkey) -> float:
    return (client.get_balance(pubkey, commitment=Confirmed).value or 0) / 1_000_000_000


def ensure_funds(client: Client, pubkey: Pubkey, min_sol: float, airdrop_sol: float = 1.0, retries: int = 2) -> bool:
    """Make sure `pubkey` holds >= min_sol. Tries small devnet airdrops; prints a clear fix if blocked."""
    try:
        bal = get_balance_sol(client, pubkey)
    except Exception as e:
        print(f"❌ Couldn't read balance ({describe_error(e)}). RPC {RPC_URL} may be down or rate-limiting.")
        return False
    if bal >= min_sol:
        print(f"💰 Wallet {str(pubkey)[:8]}… balance: {bal:.4f} SOL")
        return True
    amount = airdrop_sol
    for attempt in range(retries + 1):
        print(f"💸 Balance {bal:.4f} SOL < {min_sol} SOL. Requesting airdrop of {amount:g} SOL "
              f"(attempt {attempt + 1}/{retries + 1})…")
        try:
            sig = client.request_airdrop(pubkey, int(amount * 1_000_000_000)).value
            for _ in range(30):
                time.sleep(1)
                if get_balance_sol(client, pubkey) >= min_sol:
                    print(f"✅ Airdrop landed ({sig}). Balance: {get_balance_sol(client, pubkey):.4f} SOL")
                    return True
        except Exception as e:
            print(f"   ⚠️  Airdrop failed: {describe_error(e)[:160]}")
        amount = max(amount / 2, 0.25)
        time.sleep(10)
    print(f"❌ Could not fund {pubkey}.")
    print("   The public devnet faucet is rate-limited. Fix one of:")
    print(f"     • Send devnet SOL to {pubkey} (needs ≥ {min_sol} SOL): https://faucet.solana.com")
    print(f"     • or: solana transfer {pubkey} {max(min_sol, 0.2):g} --url {RPC_URL}")
    print("     • or point BOAT_ADMIN_KEYPAIR at an already-funded devnet keypair file.")
    return False


# --------------------------------------------------------------------------- transactions
LAST_ERROR = ""  # text of the most recent send_and_confirm failure ("" after a success); lets tests assert the exact error


def send_and_confirm(client: Client, instructions, signers, payer: Keypair, timeout: int = 60, label: str = ""):
    """Sign with `signers` (must include payer), send, and wait for `confirmed`. Returns signature or None."""
    global LAST_ERROR
    LAST_ERROR = ""
    try:
        blockhash = client.get_latest_blockhash(Confirmed).value.blockhash
        msg = Message(list(instructions), payer.pubkey())
        tx = Transaction(list(signers), msg, blockhash)
        sig = client.send_transaction(tx, opts=TxOpts(skip_preflight=False, preflight_commitment=Confirmed)).value
    except Exception as e:
        LAST_ERROR = describe_error(e)
        print(f"❌ {label or 'Transaction'} rejected: {LAST_ERROR}")
        return None
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            st = client.get_signature_statuses([sig]).value[0]
            if st is not None:
                if st.err is not None:
                    LAST_ERROR = str(st.err)
                    print(f"❌ {label or 'Transaction'} failed on-chain: {st.err}")
                    return None
                if st.confirmation_status is not None and str(st.confirmation_status).lower().endswith(("confirmed", "finalized")):
                    return sig
        except Exception:
            pass
        time.sleep(1)
    print(f"❌ {label or 'Transaction'} not confirmed within {timeout}s (sig {sig}).")
    return None


def explorer(sig) -> str:
    cluster = "devnet" if "devnet" in RPC_URL else "custom&customUrl=" + RPC_URL
    return f"https://explorer.solana.com/tx/{sig}?cluster={cluster}"


def wait_for_cluster_time(client: Client, target_ts: int, max_wait: int = 180):
    """Block until the cluster's block time >= target_ts (validator clock can differ from wall clock)."""
    deadline = time.time() + max_wait
    while time.time() < deadline:
        try:
            bt = client.get_block_time(client.get_slot(Confirmed).value).value
            if bt is not None and bt >= target_ts:
                return bt
        except Exception:
            pass
        time.sleep(1.5)
    raise TimeoutError("Cluster clock never reached the election start time.")


def cluster_time(client: Client) -> int:
    try:
        bt = client.get_block_time(client.get_slot(Confirmed).value).value
        if bt:
            return int(bt)
    except Exception:
        pass
    return int(time.time())


# --------------------------------------------------------------------------- account decoding (Borsh)
class _Reader:
    def __init__(self, data: bytes, offset: int = 8):
        self.d, self.o = data, offset

    def take(self, n):
        b = self.d[self.o:self.o + n]
        self.o += n
        return b

    def u8(self): return self.take(1)[0]
    def bool(self): return self.u8() != 0
    def u32(self): return struct.unpack("<I", self.take(4))[0]
    def u64(self): return struct.unpack("<Q", self.take(8))[0]
    def i64(self): return struct.unpack("<q", self.take(8))[0]
    def pubkey(self): return Pubkey.from_bytes(self.take(32))
    def string(self): return self.take(self.u32()).decode("utf-8")
    def opt(self, fn): return fn() if self.u8() == 1 else None


@dataclass
class ElectionAccount:
    authority: Pubkey
    title: str
    start_time: int
    end_time: int
    sbt_mint: Pubkey
    total_weight: int
    registered_voter_count: int
    outcome_count: int


@dataclass
class OutcomeAccount:
    election: Pubkey
    index: int
    label: str


@dataclass
class VoterRegistryAccount:
    address: Pubkey
    election: Pubkey
    voter: Pubkey
    weight: int
    is_whitelisted: bool
    has_voted: bool
    current_vote: Optional[str]
    vote_changes_used: int
    delegated_to: Optional[Pubkey]


def _check(data: bytes, name: str):
    if bytes(data[:8]) != _ACCT_DISC[name]:
        raise ValueError(f"Account is not a {name} (discriminator mismatch)")


def decode_election(data: bytes) -> ElectionAccount:
    _check(data, "Election")
    r = _Reader(data)
    authority, title, start, end, mint = r.pubkey(), r.string(), r.i64(), r.i64(), r.pubkey()
    r.u8()  # bump
    total_weight = r.u64()
    r.u64()  # denom_factor
    count, outcomes = r.u32(), r.u8()
    return ElectionAccount(authority, title, start, end, mint, total_weight, count, outcomes)


def decode_outcome(data: bytes) -> OutcomeAccount:
    _check(data, "ElectionOutcome")
    r = _Reader(data)
    return OutcomeAccount(r.pubkey(), r.u8(), r.string())


def decode_voter_registry(address: Pubkey, data: bytes) -> VoterRegistryAccount:
    _check(data, "VoterRegistry")
    r = _Reader(data)
    election, voter, weight = r.pubkey(), r.pubkey(), r.u64()
    wl, voted = r.bool(), r.bool()
    cur = r.opt(r.string)
    changes = r.u8()
    deleg = r.opt(r.pubkey)
    return VoterRegistryAccount(address, election, voter, weight, wl, voted, cur, changes, deleg)


def fetch_election(client: Client, election: Pubkey) -> ElectionAccount:
    info = client.get_account_info(election, commitment=Confirmed).value
    if info is None:
        raise LookupError(f"Election account {election} not found on {RPC_URL}")
    return decode_election(bytes(info.data))


def fetch_outcomes(client: Client, election: Pubkey, count: int) -> List[OutcomeAccount]:
    keys = [outcome_pda(election, i) for i in range(count)]
    infos = client.get_multiple_accounts(keys, commitment=Confirmed).value
    return [decode_outcome(bytes(a.data)) for a in infos if a is not None]


_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = _B58[r] + out
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + out


def fetch_voter_registries(client: Client, election: Pubkey, known_voters: Optional[List[Pubkey]] = None) -> List[VoterRegistryAccount]:
    """All VoterRegistry accounts of an election. Uses getProgramAccounts (memcmp on discriminator + election);
    if the RPC refuses that, falls back to the explicit `known_voters` list."""
    try:
        resp = client.get_program_accounts(
            PROGRAM_ID, commitment=Confirmed, encoding="base64",
            filters=[
                MemcmpOpts(offset=0, bytes=b58encode(account_discriminator("VoterRegistry"))),
                MemcmpOpts(offset=8, bytes=str(election)),
            ],
        )
        return [decode_voter_registry(a.pubkey, bytes(a.account.data)) for a in resp.value]
    except Exception as e:
        if not known_voters:
            raise
        print(f"   ⚠️  getProgramAccounts unavailable ({describe_error(e)[:80]}); reading known voter accounts instead.")
        keys = [voter_registry_pda(election, v) for v in known_voters]
        infos = client.get_multiple_accounts(keys, commitment=Confirmed).value
        return [decode_voter_registry(k, bytes(a.data)) for k, a in zip(keys, infos) if a is not None]


def tally_from_chain(client: Client, election: Pubkey, known_voters: Optional[List[Pubkey]] = None):
    """Read the election, its outcome accounts and every voter registry, then count weight per candidate.
    Returns (election_account, outcomes, {label: weight}, [voter registries])."""
    el = fetch_election(client, election)
    outcomes = fetch_outcomes(client, election, el.outcome_count)
    regs = fetch_voter_registries(client, election, known_voters)
    tally = {o.label: 0 for o in outcomes}
    for r in regs:
        if r.has_voted and r.current_vote in tally:
            tally[r.current_vote] += r.weight
    return el, outcomes, tally, regs
