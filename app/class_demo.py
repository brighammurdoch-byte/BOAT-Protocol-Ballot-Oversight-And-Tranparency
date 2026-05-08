import time
import json
import random
import os
import base64
from solana.rpc.api import Client
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from Voter import Voter
from ElectionInit import ElectionInit
from Candidate import Candidate

# --- CONFIGURATION ---
PROGRAM_ID = Pubkey.from_string("5ZvG5oXKD6YKgWkAKWQMjdAb3vXEWzRNNGk3uRSt63gP")
ADMIN_KEY_FILE = os.path.join(os.path.dirname(__file__), "admin.json")

def get_balance_sol(client: Client, pubkey: Pubkey) -> float:
    resp = client.get_balance(pubkey)
    lamports = resp.value if resp and resp.value is not None else 0
    return lamports / 1_000_000_000

def ensure_devnet_funds(client: Client, pubkey: Pubkey, min_sol: float = 0.25, top_up_sol: float = 1.0):
    """
    Ensures `pubkey` has at least `min_sol` SOL on devnet by requesting an airdrop if needed.
    """
    try:
        bal = get_balance_sol(client, pubkey)
    except Exception as e:
        print(f"❌ Couldn't read balance for {str(pubkey)[:8]}... ({e})")
        print("   This usually means the RPC is down, rate-limiting, or DNS/network is flaky.")
        return False
    if bal >= min_sol:
        print(f"💰 Admin balance: {bal:.4f} SOL")
        return True
    lamports = int(top_up_sol * 1_000_000_000)
    print(f"💸 Low balance for {str(pubkey)[:8]}... ({bal:.4f} SOL). Requesting airdrop of {top_up_sol:.2f} SOL...")
    try:
        sig = client.request_airdrop(pubkey, lamports).value
        print(f"⏳ Airdrop submitted: https://explorer.solana.com/tx/{sig}?cluster=devnet")
    except Exception as e:
        print(f"❌ Airdrop failed ({e}). Devnet faucet/RPC is probably rate-limiting.")
        print("   Fix: fund the demo admin wallet manually from a funded wallet, then rerun.")
        print(f"   Demo admin pubkey: {pubkey}")
        print("   Example (from a wallet that has SOL on devnet):")
        print(f"     solana transfer {pubkey} 1 --url https://api.devnet.solana.com")
        return False
    # Poll a bit for confirmation
    for _ in range(20):
        time.sleep(1)
        try:
            if get_balance_sol(client, pubkey) >= min_sol:
                break
        except Exception:
            pass
    try:
        print(f"✅ New balance: {get_balance_sol(client, pubkey):.4f} SOL")
    except Exception:
        print("✅ Airdrop submitted; balance check unavailable right now.")
    return True

def pause(msg="Press Enter to continue..."):
    print(f"\n⏸️  {msg}")
    input()
    print("-" * 50 + "\n")

def tally_votes_from_blockchain(client, election_pda, candidates):
    print("\n🔎 AUDITING BLOCKCHAIN LEDGER...")
    print(f"   Target Election Account: {election_pda}")
    
    # 1. Fetch transaction history for this election
    # Note: In a real app, you'd use an indexer. For this demo, we scrape the logs.
    try:
        sigs = client.get_signatures_for_address(election_pda)
        if not sigs.value:
            print("   ⚠️  No transactions found on-chain for this election.")
            return {c.name: 0 for c in candidates}

        print(f"   Found {len(sigs.value)} transactions. Parsing logs for votes...")
        
        blockchain_tally = {c.name: 0 for c in candidates}
        
        for sig_info in sigs.value:
            if sig_info.err:
                continue # Skip failed transactions
                
            # Fetch full transaction details
            tx = client.get_transaction(sig_info.signature, max_supported_transaction_version=0)
            
            if tx.value:
                # Fix: Use JSON serialization to safely access 'meta' and 'logMessages'
                # This bypasses potential AttributeError on the solders object wrapper
                data = json.loads(tx.value.to_json())
                logs = (data.get("meta") or {}).get("logMessages") or []

                for log in logs:
                    # New Protocol parses Anchor Events (Base64) to save gas!
                    if log.startswith("Program data: "):
                        b64_data = log.split("Program data: ")[1]
                        try:
                            decoded_bytes = base64.b64decode(b64_data)
                            # For the demo, we do a quick byte-search for the candidate's name 
                            # inside the decoded Anchor event payload.
                            for c in candidates:
                                if c.name.encode('utf-8') in decoded_bytes:
                                    blockchain_tally[c.name] += 1
                                    print(f"   -> ✅ Verified Anchor Event on-chain for: {c.name} (Tx: {str(sig_info.signature)[:8]}...)")
                                    break # Move to next log once found
                        except Exception:
                            pass
        
        if sum(blockchain_tally.values()) == 0:
            print("\n   ⚠️  WARNING: Transactions found, but no votes tallied.")
            print("      Possible causes:")
            print("      1. Smart contract needs 'anchor build' & 'anchor deploy' to emit logs.")
            print("      2. Transactions are not 'CastVote' instructions (e.g. only registration).")

        return blockchain_tally
    except Exception as e:
        print(f"❌ Error reading blockchain: {e}")
        return {c.name: 0 for c in candidates}

def main():
    print("\n" + "="*50)
    print("   🚤 BOAT PROTOCOL: LIVE CLASS DEMO")
    print("="*50 + "\n")

    # 1. SETUP
    print("⚙️  Setting up environment...")
    client = Client("https://api.devnet.solana.com", commitment="confirmed")
    
    try:
        with open(ADMIN_KEY_FILE, "r") as f:
            secret = json.load(f)
            admin_kp = Keypair.from_bytes(secret)
        print(f"👤 Admin (Professor/Authority): {str(admin_kp.pubkey())[:8]}...")
    except FileNotFoundError:
        print(f"❌ Error: Could not find {ADMIN_KEY_FILE}. Please copy it to the app/ folder.")
        return

    # Make sure admin can pay rent for accounts (registrations create PDAs + ATAs)
    print(f"👤 Admin pubkey (from {ADMIN_KEY_FILE}): {admin_kp.pubkey()}")
    if not ensure_devnet_funds(client, admin_kp.pubkey(), min_sol=0.35, top_up_sol=1.0):
        return

    # Define Election Parameters
    timestamp = int(time.time())
    title = f"Class_Demo_{timestamp}"
    start_time = timestamp
    end_time = timestamp + 86400 # 24 hours
    
    # Define Candidates
    alice = Candidate("Alice (The Analyst)")
    bob = Candidate("Bob (The Banker)")
    candidates = [alice, bob]

    pause("Step 1: Initialize Election (Create the Mint)")

    # --- STEP 1: INITIALIZE ELECTION ---
    print(f"🏛️  Initializing Election: '{title}'")
    print("   -> Creating 'Election' Account (Corporate Charter)")
    print("   -> Creating 'SBT Mint' (Voting Rights Printer)")
    
    # We pass empty lists for voters/weights because we want to do registration separately for the demo
    # (Re-)check funds right before init; rent needs can vary slightly.
    if not ensure_devnet_funds(client, admin_kp.pubkey(), min_sol=0.25, top_up_sol=1.0):
        return
    try:
        ElectionInit(PROGRAM_ID, client, admin_kp, title, start_time, end_time, [], [], candidates)
    except Exception as e:
        print(f"❌ Initialization failed: {e}")
        return
    
    init_delay = 12
    print(f"⏳ Waiting {init_delay} seconds for election initialization to confirm on blockchain...")
    time.sleep(init_delay)
    
    pause("Step 2: Register 5 Voters (Issue Stock/Token)")

    # --- STEP 2: REGISTER VOTER ---
    print("👥 Creating 5 Student Voters...")
    voters = []
    for i in range(5):
        voters.append(Voter())
    
    print(f"📝 Registering {len(voters)} Voters on-chain...")
    
    for i, student in enumerate(voters):
        print(f"   -> Registering Student {i+1} ({str(student.keypair.pubkey())[:6]}...)...")
        # Admin pays fees + rent here; keep topped up as we go.
        if not ensure_devnet_funds(client, admin_kp.pubkey(), min_sol=0.15, top_up_sol=1.0):
            return
        register_ix = student.register_voter(
            PROGRAM_ID, 
            admin_kp.pubkey(), 
            student.keypair.pubkey(), 
            title, 
            weight=1
        )
        # Send transaction (Signed by Admin)
        sig = student.send_and_confirm(client, register_ix, admin_kp, admin_kp)
        if not sig:
            print("❌ Registration failed; stopping demo so votes aren't attempted with missing registries.")
            return
        time.sleep(1) # Short pause to avoid RPC rate limits
    
    reg_delay = 12
    print(f"⏳ Waiting {reg_delay} seconds for registrations to confirm...")
    time.sleep(reg_delay)

    pause("Step 3: Cast Votes (Exercise Option/Burn Token)")

    # --- STEP 3: CAST VOTE ---
    print("🗳️  Students are casting their votes independently...")
    
    for i, student in enumerate(voters):
        choice = random.choice(candidates)
        print(f"   -> Student {i+1} is voting for: {choice.name}")
        
        vote_ix = student.cast_vote(
            PROGRAM_ID, 
            admin_kp.pubkey(), 
            choice, 
            title
        )
        
        if vote_ix:
            # Send transaction (Signed by Student)
            student.send_and_confirm(client, vote_ix, student.keypair, admin_kp)
            time.sleep(1) # Prevent RPC rate limits and dropped transactions!

    vote_delay = 15
    print(f"⏳ Waiting {vote_delay} seconds for votes to be confirmed and indexed by validators...")
    time.sleep(vote_delay)

    print("\n📊 ELECTION RESULTS (Verified on Blockchain)")
    print("-" * 30)
    
    # Re-derive the Election PDA to find the address to audit
    election_pda = Pubkey.find_program_address([b"election", bytes(admin_kp.pubkey()), title.encode()], PROGRAM_ID)[0]
    
    results = tally_votes_from_blockchain(client, election_pda, candidates)
    
    print("\n🏆 FINAL TALLY:")
    for name, count in results.items():
        print(f"   {name}: {count} votes")

    print("\n" + "="*50)
    print("✅ DEMO COMPLETE")
    print("="*50)

if __name__ == "__main__":
    main()