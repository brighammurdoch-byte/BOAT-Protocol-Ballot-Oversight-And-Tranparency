"""BOAT Protocol live demo — talks directly to the Solana program (no front end).

Flow: create election → add candidates → register N voters (soulbound Token-2022 token each) →
      everyone votes → some voters CHANGE their vote → tally read from on-chain accounts.

Run:   pip install -r requirements.txt && python class_demo.py
Env:   BOAT_RPC_URL, BOAT_PROGRAM_ID, BOAT_ADMIN_KEYPAIR (see utils.py); BOAT_VOTERS (default 5);
       BOAT_NO_PAUSE=1 to run without "press Enter" pauses.
"""
import os
import random
import sys
import time

from solana.rpc.api import Client
from solana.rpc.commitment import Confirmed

from Candidate import Candidate
from ElectionInit import ElectionInit
from Voter import Voter
from utils import (
    PROGRAM_ID, RPC_URL, cluster_time, describe_error, ensure_funds, get_admin_keypair, get_balance_sol,
    tally_from_chain, wait_for_cluster_time,
)

NUM_VOTERS = int(os.environ.get("BOAT_VOTERS", "5"))
START_DELAY = 25  # seconds from now until voting opens (outcomes must be added before this)


def pause(msg="Press Enter to continue..."):
    if os.environ.get("BOAT_NO_PAUSE") or not sys.stdin.isatty():
        print(f"\n▶ {msg}")
        return
    print(f"\n⏸️  {msg}")
    input()
    print("-" * 50 + "\n")


def print_tally(client, election_pda, voters, candidates, header):
    print(f"\n📊 {header}")
    print("-" * 44)
    el, outcomes, tally, regs = tally_from_chain(client, election_pda, [v.pubkey for v in voters])
    total_votes = sum(tally.values())
    for o in outcomes:
        n = tally[o.label]
        bar = "█" * n
        print(f"   [{o.index}] {o.label:<22} {n:>3} {bar}")
    voted = sum(1 for r in regs if r.has_voted)
    print(f"   registered={el.registered_voter_count} total_weight={el.total_weight} voted={voted} "
          f"(counted weight={total_votes})")
    for c in candidates:
        c.votes_received = tally.get(c.name, 0)
    return tally, regs


def main():
    print("\n" + "=" * 50)
    print("   🚤 BOAT PROTOCOL: LIVE DEMO (direct to smart contract)")
    print("=" * 50 + "\n")
    print(f"🌐 RPC: {RPC_URL}\n📜 Program: {PROGRAM_ID}")
    client = Client(RPC_URL, commitment=Confirmed)
    try:
        client.get_version()
    except Exception as e:
        sys.exit(f"❌ Can't reach RPC {RPC_URL}: {describe_error(e)}\n   Check your network or set BOAT_RPC_URL.")
    prog = client.get_account_info(PROGRAM_ID).value
    if prog is None or not prog.executable:
        sys.exit(f"❌ Program {PROGRAM_ID} is not deployed on {RPC_URL}. Wrong cluster or BOAT_PROGRAM_ID?")

    admin = get_admin_keypair()
    print(f"👤 Admin (election authority): {admin.pubkey()}")
    # rent: election+config+mint+3 outcomes (~0.01) + ~0.005 per voter (registry + Token-2022 account)
    needed = 0.02 + 0.006 * NUM_VOTERS
    if not ensure_funds(client, admin.pubkey(), min_sol=needed, airdrop_sol=1.0):
        sys.exit(1)

    now = cluster_time(client)
    title = f"Class_Demo_{int(time.time())}"
    start_time = now + START_DELAY
    end_time = start_time + 86400
    candidates = [Candidate("Alice (The Analyst)"), Candidate("Bob (The Banker)"), Candidate("Carol (The Consultant)")]

    pause("Step 1: Initialize Election (creates the Election, Config and SBT mint) + add candidates")
    print(f"🏛️  Initializing Election: '{title}'  (voting opens in ~{START_DELAY}s)")
    try:
        init = ElectionInit(client, admin, title, start_time, end_time, candidates)
    except Exception as e:
        sys.exit(f"❌ Initialization failed: {e}")

    pause(f"Step 2: Register {NUM_VOTERS} voters (each gets a soulbound Token-2022 voting token)")
    voters = [Voter() for _ in range(NUM_VOTERS)]
    for i, v in enumerate(voters):
        print(f"   -> Registering voter {i + 1} ({str(v.pubkey)[:6]}…)")
        ix = v.register_voter(admin.pubkey(), title, weight=1)
        if not v.send_and_confirm(client, ix, admin, admin, label=f"register_voter[{i + 1}]"):
            sys.exit("❌ Registration failed; stopping so votes aren't attempted with missing registries.")

    print(f"\n⏳ Waiting for on-chain clock to pass election start ({start_time})…")
    wait_for_cluster_time(client, start_time + 2)

    pause("Step 3: Cast votes (each voter signs their own vote; admin only pays the fee)")
    rng = random.Random()
    choices = {}
    for i, v in enumerate(voters):
        choice = rng.choice(candidates)
        choices[i] = choice
        print(f"   -> Voter {i + 1} votes for: {choice.name}")
        v.send_and_confirm(client, v.cast_vote(admin.pubkey(), choice, title), v.keypair, admin, label=f"cast_vote[{i + 1}]")

    tally, _ = print_tally(client, init.election, voters, candidates, "TALLY AFTER FIRST VOTES (read from on-chain accounts)")

    pause("Step 4: A voter changes their mind (cast_vote again; free changes are limited by the election config)")
    for i in range(min(1, len(voters))):  # one change keeps the before/after tally difference easy to see
        options = [c for c in candidates if c is not choices[i]]
        new_choice = rng.choice(options)
        print(f"   -> Voter {i + 1} changes vote: {choices[i].name}  ➜  {new_choice.name}")
        if voters[i].send_and_confirm(client, voters[i].cast_vote(admin.pubkey(), new_choice, title), voters[i].keypair, admin,
                                      label=f"change_vote[{i + 1}]"):
            choices[i] = new_choice

    tally, regs = print_tally(client, init.election, voters, candidates, "FINAL TALLY (verified from on-chain VoterRegistry accounts)")
    for r in sorted(regs, key=lambda r: str(r.voter)):
        print(f"   voter {str(r.voter)[:6]}… → {r.current_vote}  (changes used: {r.vote_changes_used})")

    expected = {}
    for c in choices.values():
        expected[c.name] = expected.get(c.name, 0) + 1
    ok = all(tally.get(c.name, 0) == expected.get(c.name, 0) for c in candidates)
    winner = max(candidates, key=lambda c: c.votes_received)
    print(f"\n🏆 Winner: {winner.name} with {winner.votes_received} vote(s)")
    print(f"🔍 On-chain tally matches votes sent by this script: {'YES' if ok else 'NO'}")
    try:
        print(f"💰 Admin balance left: {get_balance_sol(client, admin.pubkey()):.4f} SOL")
    except Exception:
        pass
    print("\n" + "=" * 50)
    print("✅ DEMO COMPLETE" if ok else "⚠️  DEMO FINISHED WITH A MISMATCH")
    print("=" * 50)
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
