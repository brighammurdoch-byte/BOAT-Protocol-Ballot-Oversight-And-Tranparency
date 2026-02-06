import time
import json
import random
from solana.rpc.api import Client
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from Voter import Voter
from ElectionInit import ElectionInit
from Candidate import Candidate

# --- CONFIGURATION ---
PROGRAM_ID = Pubkey.from_string("EWatwsCrcnLninbUQV6yJzFreJHVhCnSm6LxB7aooHvg")
ADMIN_KEY_FILE = "admin.json"

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
                    if "Vote recorded for: " in log:
                        # Extract candidate name from the log string
                        voted_name = log.split("Vote recorded for: ")[1].strip()
                        if voted_name in blockchain_tally:
                            blockchain_tally[voted_name] += 1
                            print(f"   -> ✅ Verified vote on-chain for: {voted_name} (Tx: {str(sig_info.signature)[:8]}...)")
        
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
    client = Client("https://api.devnet.solana.com")
    
    try:
        with open(ADMIN_KEY_FILE, "r") as f:
            secret = json.load(f)
            admin_kp = Keypair.from_bytes(secret)
        print(f"👤 Admin (Professor/Authority): {str(admin_kp.pubkey())[:8]}...")
    except FileNotFoundError:
        print(f"❌ Error: Could not find {ADMIN_KEY_FILE}. Please copy it to the app/ folder.")
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
    ElectionInit(PROGRAM_ID, client, admin_kp, title, start_time, end_time, [], [], candidates)
    
    print("⏳ Waiting 20 seconds for election initialization to confirm on blockchain...")
    time.sleep(20)
    
    pause("Step 2: Register 5 Voters (Issue Stock/Token)")

    # --- STEP 2: REGISTER VOTER ---
    print("👥 Creating 5 Student Voters...")
    voters = []
    for i in range(5):
        voters.append(Voter())
    
    print(f"📝 Registering {len(voters)} Voters on-chain...")
    
    for i, student in enumerate(voters):
        print(f"   -> Registering Student {i+1} ({str(student.keypair.pubkey())[:6]}...)...")
        register_ix = student.register_voter(
            PROGRAM_ID, 
            admin_kp.pubkey(), 
            student.keypair.pubkey(), 
            title, 
            weight=1
        )
        # Send transaction (Signed by Admin)
        student.send_and_confirm(client, register_ix, admin_kp, admin_kp)
        time.sleep(1) # Short pause to avoid RPC rate limits
    
    print("⏳ Waiting 15 seconds for registrations to confirm...")
    time.sleep(15)

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
            # Note: We are NOT updating a local variable here anymore.
            # We will read the truth from the blockchain in the next step.

    print("⏳ Waiting 15 seconds for votes to be confirmed by validators...")
    time.sleep(15)

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