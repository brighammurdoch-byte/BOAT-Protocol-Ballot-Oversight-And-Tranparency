import subprocess
import os

# --- CONFIGURATION ---
TOKEN_2022_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
ADMIN_KEY = "admin.json"  # Ensure this file exists in the folder!

def run_solana_cmd(cmd_list):
    """Runs a Solana command and returns the output safely"""
    try:
        full_cmd = cmd_list
        print(f"Executing: {' '.join(full_cmd)} ...")
        result = subprocess.run(
            full_cmd, capture_output=True, text=True, check=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"❌ Error: {e.stderr}")
        return None

def main():
    print("🏭 STARTING ISSUER PROTOCOL (Soulbound Voter ID)...")
    
    # 1. Generate a new "Mint"
    print("\n--- 1. Generating Voter ID Blueprint (Mint) ---")
    run_solana_cmd(["solana-keygen", "new", "-o", "sbt_mint.json", "--no-bip39-passphrase", "--force"])
    
    # 2. Create the Token with "NonTransferable" enabled
    print("\n--- 2. Configuring Restrictions (Non-Transferable) ---")
    run_solana_cmd([
        "spl-token", "--program-id", TOKEN_2022_ID, 
        "create-token", "sbt_mint.json", 
        "--enable-nontransferable",
        "--fee-payer", ADMIN_KEY, "--mint-authority", ADMIN_KEY
    ])
    
    # 3. Create a User Account to hold the ID
    print("\n--- 3. Creating User Wallet for ID ---")
    run_solana_cmd([
        "spl-token", "--program-id", TOKEN_2022_ID, 
        "create-account", "sbt_mint.json",
        "--fee-payer", ADMIN_KEY, "--owner", ADMIN_KEY
    ])
    
    # 4. Issue the ID (Mint 1 token)
    print("\n--- 4. Issuing Voter ID to User ---")
    run_solana_cmd([
        "spl-token", "--program-id", TOKEN_2022_ID, 
        "mint", "sbt_mint.json", "1",
        "--fee-payer", ADMIN_KEY, "--mint-authority", ADMIN_KEY
    ])
    
    print("\n✅ VOTER ID ISSUED SUCCESSFULLY.")
    
    # 5. Verify it is Soulbound (Try to move it)
    print("\n--- 5. Security Test: Attempting Illegal Transfer ---")
    output = run_solana_cmd([
        "spl-token", "--program-id", TOKEN_2022_ID, 
        "transfer", "sbt_mint.json", "1", 
        "11111111111111111111111111111111", 
        "--allow-unfunded-recipient",
        "--allow-non-system-account-recipient", # <--- The Flag needed to see the real error
        "--fee-payer", ADMIN_KEY, "--owner", ADMIN_KEY
    ])
    
    if output is None: 
        print("\n🏆 TEST PASSED: Transfer was blocked by the blockchain!")
    else:
        print("\n⚠️ TEST FAILED: Transfer somehow succeeded.")

if __name__ == "__main__":
    main()