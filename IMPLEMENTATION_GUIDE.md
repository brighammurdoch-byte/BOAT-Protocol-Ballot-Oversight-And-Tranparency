# BOAT Protocol - Implementation Guide & Examples

## Quick Start: Using the New Features

### Environment Setup
```bash
# WSL/Linux
cd /path/to/BOAT
anchor build
anchor deploy --provider.cluster devnet
```

---

## Example 1: Basic Weighted Voting Election

### Scenario
A startup wants to conduct a shareholder vote where share ownership equals voting weight.

### Setup Code
```javascript
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const program = anchor.workspace.BoatFinal;
const provider = anchor.AnchorProvider.local();
anchor.setProvider(provider);

// ============= STEP 1: Initialize Election =============
const title = "2026 Q1 Board Election";
const startTime = Math.floor(Date.now() / 1000) + 3600;      // 1 hour from now
const endTime = startTime + 86400;                            // 24 hours duration

const [electionPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("election"), provider.wallet.publicKey, Buffer.from(title)],
  program.programId
);

const [configPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("config"), electionPda],
  program.programId
);

const initTx = await program.methods
  .initializeElection(title, new anchor.BN(startTime), new anchor.BN(endTime))
  .accounts({
    authority: provider.wallet.publicKey,
    election: electionPda,
    electionConfig: configPda,
    // sbt_mint will be auto-derived
  })
  .rpc();

console.log("Election created:", initTx);

// ============= STEP 2: Configure Defaults =============
const configTx = await program.methods
  .setElectionConfig(
    new anchor.BN(1),        // default_voter_weight: 1
    33,                       // quorum_percentage: 33%
    2,                        // max_free_vote_changes: 2
    new anchor.BN(5_000_000), // price_per_vote_change: 0.005 SOL
    true                      // allow_delegation: true
  )
  .accounts({
    authority: provider.wallet.publicKey,
    election: electionPda,
    electionConfig: configPda,
  })
  .rpc();

console.log("Config updated:", configTx);

// ============= STEP 3: Register Voters with Weights =============
const voters = [
  { name: "Alice", address: new PublicKey("...alice..."), weight: 100 },
  { name: "Bob", address: new PublicKey("...bob..."), weight: 50 },
  { name: "Charlie", address: new PublicKey("...charlie..."), weight: 25 },
];

for (const voter of voters) {
  const [voterRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("voter_registry"), electionPda, voter.address],
    program.programId
  );

  const registerTx = await program.methods
    .registerVoter(new anchor.BN(voter.weight))
    .accounts({
      authority: provider.wallet.publicKey,
      election: electionPda,
      electionConfig: configPda,
      voter: voter.address,
      voterRegistry: voterRegistryPda,
      // voter_token_account will be auto-derived
    })
    .rpc();

  console.log(`Registered ${voter.name} with weight ${voter.weight}:`, registerTx);
}

// ============= STEP 4: VOTING PERIOD BEGINS =============
// Wait for startTime...

// ============= STEP 5: Voters Cast Votes =============
// Alice's vote
const aliceVoteTx = await program.methods
  .castVote("Candidate X")
  .accounts({
    voter: voters[0].address,
    election: electionPda,
    electionConfig: configPda,
    feeReceiver: provider.wallet.publicKey,
    // ... other accounts
  })
  .rpc();

console.log("Alice voted:", aliceVoteTx);

// Bob's first vote (free)
const bobVote1Tx = await program.methods
  .castVote("Candidate Y")
  .accounts({
    voter: voters[1].address,
    election: electionPda,
    electionConfig: configPda,
    feeReceiver: provider.wallet.publicKey,
  })
  .rpc();

console.log("Bob's first vote (free):", bobVote1Tx);

// Bob changes mind (free - still within 2 free changes)
const bobVote2Tx = await program.methods
  .castVote("Candidate Z")
  .accounts({
    voter: voters[1].address,
    election: electionPda,
    electionConfig: configPda,
    feeReceiver: provider.wallet.publicKey,
  })
  .rpc();

console.log("Bob's second vote (free):", bobVote2Tx);

// Bob changes again (PAID - 3rd change)
const bobVote3Tx = await program.methods
  .castVote("Candidate X")
  .accounts({
    voter: voters[1].address,
    election: electionPda,
    electionConfig: configPda,
    feeReceiver: provider.wallet.publicKey,
  })
  .rpc();

console.log("Bob's third vote (PAID 0.005 SOL):", bobVote3Tx);

// ============= STEP 6: Off-Chain Vote Tallying =============
const voteEvents = await program.getProgramEventEmitter()
  .getEvents()
  .filter(e => e.name === "VoteCast");

// Index vote event logs to get final votes
const finalVotes = {};
for (const event of voteEvents) {
  const voter = event.data.voter.toString();
  finalVotes[voter] = {
    candidate: event.data.candidate,
    weight: event.data.weight,
    timestamp: event.data.timestamp,
    changeNumber: event.data.voteChangeNumber,
  };
}

// Tally results
const results = {};
for (const [voter, vote] of Object.entries(finalVotes)) {
  const candidate = vote.candidate;
  results[candidate] = (results[candidate] || 0) + vote.weight;
}

console.log("Election Results:", results);
// Output: { "Candidate X": 175, "Candidate Z": 50 }
// Candidate X wins with 175 votes
```

---

## Example 2: Delegated Voting

### Scenario
A board member is sick and wants to delegate their vote to a trusted colleague.

```javascript
// Charlie delegates his 25 votes to Alice
const delegateTx = await program.methods
  .delegateVote()
  .accounts({
    voter: voters[2].address,  // Charlie
    election: electionPda,
    electionConfig: configPda,
    voterRegistry: charlieRegistryPda,
    delegateRegistry: aliceRegistryPda,  // Alice is the delegate
  })
  .rpc();

console.log("Charlie delegated to Alice:", delegateTx);

// Now Alice can vote with:
// - Her own weight: 100
// - Charlie's delegated weight: 25
// Total: 125

const aliceVoteWithDelegationTx = await program.methods
  .castVote("Candidate X")
  .accounts({
    voter: voters[0].address,  // Alice
    election: electionPda,
    electionConfig: configPda,
    feeReceiver: provider.wallet.publicKey,
    voterRegistry: aliceRegistryPda,
  })
  .rpc();

console.log("Alice voted with delegation:", aliceVoteWithDelegationTx);
// Alice's vote now counts as 125 votes
```

---

## Example 3: DAO Token-Based Voting

### Scenario
A DAO wants members with VOTE tokens to participate in governance, with 1 token = 1 vote.

```javascript
import { Token } from "@solana/spl-token";

// ============= STEP 1: Create or Use Existing Governance Token =============
const tokenMint = new PublicKey("Vote...tokenMintAddress...");

// ============= STEP 2: Initialize Election (same as before) =============
// ... (same as Example 1, Steps 1-2)

// ============= STEP 3: Enable Token-Based Voting =============
const enableTokenVotingTx = await program.methods
  .enableTokenVoting(new anchor.BN(100))  // Min balance: 100 tokens
  .accounts({
    authority: provider.wallet.publicKey,
    election: electionPda,
    electionConfig: configPda,
    tokenMint: tokenMint,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .rpc();

console.log("Token voting enabled (min 100 tokens):", enableTokenVotingTx);

// ============= STEP 4: DAO Members Vote =============
// Get member's token account
const memberTokenAccount = await Token.getAssociatedTokenAddress(
  tokenMint,
  memberAddress
);

// Member with 500 VOTE tokens votes
const memberVoteTx = await program.methods
  .castVoteWithToken("Proposal: Increase Treasury By 10%")
  .accounts({
    voter: memberAddress,
    election: electionPda,
    electionConfig: configPda,
    voterTokenAccount: memberTokenAccount,
    tokenMint: tokenMint,
    tokenProgram: anchor.web3.TOKEN_PROGRAM_ID,
  })
  .rpc();

console.log("DAO member voted with 500 tokens:", memberVoteTx);

// ============= STEP 5: Tally Results (Off-Chain) =============
const daoVotes = {};
for (const event of voteEvents.filter(e => e.name === "VoteCast")) {
  const proposal = event.data.candidate;
  const weight = event.data.weight;
  daoVotes[proposal] = (daoVotes[proposal] || 0) + weight;
}

console.log("DAO Vote Results:", daoVotes);
// Output: { "Proposal: Increase Treasury By 10%": 1250 }
// Proposal passes if quorum (33% of 10,000 total tokens) reached
```

---

## Example 4: Advanced Configuration

### Scenario
A corporate election with strict requirements:
- 50 shares = 1 vote (dilutes large shareholders)
- 50% quorum required
- Only 1 free vote change
- Pay $0.01 per additional change

```javascript
// ============= Setup with Custom Configuration =============
const [electionPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("election"), authority.publicKey, Buffer.from("Annual Shareholder Meeting 2026")],
  program.programId
);

// Initialize
await program.methods
  .initializeElection(
    "Annual Shareholder Meeting 2026",
    new anchor.BN(startTime),
    new anchor.BN(endTime)
  )
  .rpc();

// Configure before voting starts
await program.methods
  .setElectionConfig(
    new anchor.BN(1),              // default: 1 vote = 50 shares (applied at registration)
    50,                            // 50% quorum
    1,                             // Only 1 free change
    new anchor.BN(10_000_000),     // 0.01 SOL per additional change
    false                          // Disable delegation (strict rules)
  )
  .accounts({
    authority: authority.publicKey,
    election: electionPda,
    electionConfig: configPda,
  })
  .rpc();

// Register shareholders with adjusted weights
// 500 shares → weight 10 (500 ÷ 50)
await program.methods
  .registerVoter(new anchor.BN(10))  // 500 shares
  .accounts({
    authority: authority.publicKey,
    voter: shareholder1,
    // ... other accounts
  })
  .rpc();

// 1000 shares → weight 20
await program.methods
  .registerVoter(new anchor.BN(20))  // 1000 shares
  .rpc();
```

---

## Example 5: Complete Audit Trail

### Scenario
Verifying election integrity by examining the complete vote history.

```javascript
// ============= Retrieve All Vote Events =============
const allVoteEvents = await program.getProgramEventEmitter()
  .getEvents(electionPda)
  .filter(e => e.name === "VoteCast")
  .sort((a, b) => a.data.timestamp - b.data.timestamp);

// ============= Build Vote History =============
const voteHistory = {};

for (const event of allVoteEvents) {
  const voter = event.data.voter.toString();
  const changeNum = event.data.voteChangeNumber;
  
  if (!voteHistory[voter]) {
    voteHistory[voter] = [];
  }
  
  voteHistory[voter].push({
    changeNumber: changeNum,
    candidate: event.data.candidate,
    weight: event.data.weight,
    timestamp: new Date(event.data.timestamp * 1000),
    verified: true,  // Event proves this happened
  });
}

// ============= Integrity Check =============
for (const [voter, votes] of Object.entries(voteHistory)) {
  console.log(`\nVoter: ${voter}`);
  votes.forEach(v => {
    console.log(`  Change ${v.changeNumber}: ${v.candidate} (${v.weight} votes) at ${v.timestamp}`);
  });
  
  // Verify:
  // 1. Vote changes are sequential
  // 2. Final vote is marked as change number
  // 3. Number of changes ≤ max_free + paid
}

// ============= Generate Report =============
const report = {
  election: title,
  startTime: new Date(startTime * 1000),
  endTime: new Date(endTime * 1000),
  totalVoters: Object.keys(voteHistory).length,
  totalVotes: allVoteEvents.reduce((sum, e) => sum + e.data.weight, 0),
  totalChanges: allVoteEvents.filter(e => e.data.voteChangeNumber > 0).length,
  averageChangesPerVoter: (
    allVoteEvents.filter(e => e.data.voteChangeNumber > 0).length /
    Object.keys(voteHistory).length
  ),
  finalResults: results,
};

console.log("\n=== ELECTION REPORT ===");
console.log(JSON.stringify(report, null, 2));
```

---

## Error Handling Examples

```javascript
// ============= Test Error Conditions =============

// 1. Voting when not whitelisted
try {
  await program.methods
    .castVote("Candidate X")
    .accounts({
      voter: unregisteredVoter,
      // ...
    })
    .rpc();
} catch (err) {
  console.log("Expected error:", err.message);
  // Error: 6000 - Voter is not whitelisted
}

// 2. Voting after election ends
try {
  await program.methods
    .castVote("Candidate X")
    .accounts({
      voter: voters[0].address,
      // ...
    })
    .rpc();
} catch (err) {
  console.log("Expected error:", err.message);
  // Error: 6001 - Election is already over
}

// 3. Delegating when no votes left
try {
  await program.methods
    .delegateVote()
    .accounts({
      voter: alreadyVoted,
      delegateRegistry: delegate,
      // ...
    })
    .rpc();
} catch (err) {
  console.log("Expected error:", err.message);
  // Error: 6005 - Voter has already cast a vote
}

// 4. Token voting disabled
try {
  await program.methods
    .castVoteWithToken("Proposal X")
    .accounts({
      voter: member,
      // ...
    })
    .rpc();
} catch (err) {
  console.log("Expected error:", err.message);
  // Error: 6010 - Token-based voting is not enabled
}

// 5. Insufficient token balance for DAO vote
try {
  await program.methods
    .castVoteWithToken("Proposal X")
    .accounts({
      voter: poorMember,  // Only has 50 tokens, min is 100
      // ...
    })
    .rpc();
} catch (err) {
  console.log("Expected error:", err.message);
  // Error: 6011 - Voter does not have sufficient token balance
}
```

---

## Gas/Cost Analysis

### Example: 100-Voter Election

| Operation | Gas Units | Cost (SOL @ 5 μ lamports) |
|-----------|-----------|--------------------------|
| Initialize Election | ~5,000 | ~0.025 |
| Set Config | ~3,000 | ~0.015 |
| Register 1 Voter | ~8,000 | ~0.040 |
| Cast Vote (1st) | ~6,000 | ~0.030 |
| Cast Vote (free change) | ~6,000 | ~0.030 |
| Cast Vote (paid change) + Fee | ~6,500 | ~0.035 + 0.001 to 0.01 |
| **Total for 100 voters** | ~500,000 | **~2.5 SOL** |
| **Off-Chain Tallying** | ~0 | **Free** |

**Optimization benefit**: Without off-chain tallying (~50,000 compute units saved = ~0.25 SOL)

---

## Testing Checklist

```javascript
// ✅ Unit Tests for Each Feature

describe("Weighted Voting", () => {
  it("registers voters with correct weights", async () => {
    // Test implementation
  });
  
  it("sums weights correctly in events", async () => {
    // Test implementation
  });
});

describe("Voter Whitelisting", () => {
  it("blocks unregistered voters", async () => {
    // Test implementation
  });
  
  it("allows whitelisted voters", async () => {
    // Test implementation
  });
});

describe("Delegated Voting", () => {
  it("delegates votes correctly", async () => {
    // Test implementation
  });
  
  it("prevents delegated voters from voting", async () => {
    // Test implementation
  });
});

describe("Vote Changeability", () => {
  it("allows free changes up to limit", async () => {
    // Test implementation
  });
  
  it("charges for additional changes", async () => {
    // Test implementation
  });
});

describe("DAO Token Voting", () => {
  it("enables token-based voting", async () => {
    // Test implementation
  });
  
  it("rejects voters below minimum balance", async () => {
    // Test implementation
  });
});

describe("Off-Chain Tallying", () => {
  it("correctly tallies votes from events", async () => {
    // Test implementation
  });
  
  it("handles vote changes correctly", async () => {
    // Test implementation
  });
});
```

---

## Deployment Checklist

- [ ] Deploy to devnet
- [ ] Create test election
- [ ] Register test voters with various weights
- [ ] Test voting functionality
- [ ] Test delegation
- [ ] Test vote changes (free and paid)
- [ ] Test DAO token voting
- [ ] Verify event emissions
- [ ] Test off-chain tallying
- [ ] Audit security (no double voting, etc.)
- [ ] Deploy to testnet
- [ ] Deploy to mainnet-beta
- [ ] Deploy to mainnet
