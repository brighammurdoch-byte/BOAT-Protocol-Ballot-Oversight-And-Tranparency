# BOAT Protocol - API Reference

## Quick Function Reference

### Administrative Functions

#### `initialize_election(title, start_time, end_time)`
Creates a new election with default configuration.

**Parameters:**
- `title: String` - Election name
- `start_time: i64` - Unix timestamp when voting starts
- `end_time: i64` - Unix timestamp when voting ends

**Accounts Needed:**
- `authority` (signer) - Election creator
- `election` (PDA to create)
- `election_config` (PDA to create)
- `sbt_mint` (new mint for voting tokens)
- `system_program`, `token_program`, `rent`

**Default Configuration Applied:**
- `default_voter_weight: 1`
- `quorum_percentage: 33`
- `max_free_vote_changes: 2`
- `price_per_vote_change: 0`
- `allow_delegation: true`
- `allow_token_voting: false`

**Returns:** `Result<()>`

**Example:**
```typescript
await program.methods
  .initializeElection(
    "2026 Board Election",
    Math.floor(Date.now() / 1000) + 3600,
    Math.floor(Date.now() / 1000) + 86400
  )
  .accounts({
    authority: walletPubkey,
    election: electionPda,
    electionConfig: configPda,
    sbtMint: mintPda,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

---

#### `set_election_config(default_voter_weight, quorum_percentage, max_free_vote_changes, price_per_vote_change, allow_delegation)`
Updates election configuration **before voting starts**.

**Parameters:**
- `default_voter_weight: u64` - Default votes per voter if not specified
- `quorum_percentage: u8` - Required participation (1-100)
- `max_free_vote_changes: u8` - Number of free vote changes
- `price_per_vote_change: u64` - Fee in lamports for additional changes
- `allow_delegation: bool` - Whether voting can be delegated

**Accounts Needed:**
- `authority` (signer)
- `election`
- `election_config` (to update)

**Access Control:** Only election authority can call

**Constraints:**
- `quorum_percentage` must be 1-100
- Can only be called before voting starts

**Example:**
```typescript
await program.methods
  .setElectionConfig(
    new anchor.BN(10),           // 10 votes default
    50,                          // 50% quorum
    1,                           // 1 free change
    new anchor.BN(5_000_000),   // 0.005 SOL per change
    false                        // No delegation
  )
  .accounts({
    authority: walletPubkey,
    election: electionPda,
    electionConfig: configPda,
  })
  .rpc();
```

---

#### `enable_token_voting(min_token_balance)`
Enables DAO-style voting based on governance token holdings.

**Parameters:**
- `min_token_balance: u64` - Minimum tokens required to vote

**Accounts Needed:**
- `authority` (signer)
- `election`
- `election_config` (to update)
- `token_mint` (the governance token)
- `system_program`

**Access Control:** Only election authority

**Effect:** 
- Sets `allow_token_voting: true`
- Sets `token_mint` to provided mint
- Sets `min_token_balance` to provided value

**Note:** Disables whitelist-based voting; voters must use `cast_vote_with_token()` instead

**Example:**
```typescript
await program.methods
  .enableTokenVoting(new anchor.BN(100))  // Min 100 tokens
  .accounts({
    authority: walletPubkey,
    election: electionPda,
    electionConfig: configPda,
    tokenMint: govTokenMintPubkey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

#### `register_voter(weight)`
Adds a voter to the whitelist with specified voting weight.

**Parameters:**
- `weight: u64` - Voting weight (0 = use default)

**Accounts Needed:**
- `authority` (signer)
- `election`
- `election_config`
- `sbt_mint`
- `voter` (unchecked - the person being registered)
- `voter_registry` (PDA to create)
- `voter_token_account` (ATA to create)
- `system_program`, `token_program`, `associated_token_program`

**Access Control:** Only election authority via `authority` signer

**Side Effects:**
- Mints voting tokens to voter's ATA
- Creates VoterRegistry PDA
- Increments election's `total_weight`
- Sets `is_whitelisted: true` in registry

**Note:** Weight of 0 applies default from config

**Example:**
```typescript
await program.methods
  .registerVoter(new anchor.BN(100))  // 100 votes
  .accounts({
    authority: walletPubkey,
    election: electionPda,
    electionConfig: configPda,
    sbtMint: mintPda,
    voter: voterPubkey,
    voterRegistry: voterRegistryPda,
    voterTokenAccount: voterAtaPda,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  })
  .rpc();
```

---

### Voter Functions

#### `cast_vote(candidate)`
Submits a vote for a candidate. Supports vote changes up to configured limit.

**Parameters:**
- `candidate: String` - Name of candidate to vote for

**Accounts Needed:**
- `voter` (signer)
- `fee_receiver` (where paid change fees go)
- `election`
- `election_config`
- `sbt_mint`
- `voter_registry` (must be whitelisted)
- `voter_token_account`
- `token_program`

**Access Control:** Only registered, whitelisted voters

**Constraints:**
- Election must be started (`now >= start_time`)
- Election must not be ended (`now <= end_time`)
- Voter must be whitelisted
- Voter must not have delegated their vote
- Voter must have voting tokens

**Behavior on First Vote:**
- Sets `has_voted: true`
- Records vote in `current_vote`
- Emits `VoteCast` event with `vote_change_number: 0`

**Behavior on Vote Change:**
- If changes < `max_free_vote_changes`: No fee (free)
- If changes >= `max_free_vote_changes`: Must pay fee (if > 0)
- Updates `current_vote` to new candidate
- Increments `vote_changes_used`
- Emits new `VoteCast` event

**Payment Logic:**
```javascript
if (voter_registry.has_voted) {
    if (voter_registry.vote_changes_used >= config.max_free_vote_changes) {
        if (config.price_per_vote_change > 0) {
            voter.lamports -= config.price_per_vote_change;
            fee_receiver.lamports += config.price_per_vote_change;
        }
    }
    voter_registry.vote_changes_used += 1;
}
```

**Example:**
```typescript
// First vote (free)
await program.methods
  .castVote("Alice")
  .accounts({
    voter: voterPubkey,
    feeReceiver: authorityPubkey,
    election: electionPda,
    electionConfig: configPda,
    sbtMint: mintPda,
    voterRegistry: voterRegistryPda,
    voterTokenAccount: voterAtaPda,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();

// Second vote - same as first (still free)
await program.methods
  .castVote("Bob")
  .accounts({
    // ... same accounts
  })
  .rpc();

// Third vote (PAID - costs 0.005 SOL)
await program.methods
  .castVote("Alice")
  .accounts({
    // ... same accounts
  })
  .rpc();
```

---

#### `cast_vote_with_token(candidate)`
Submits a vote based on governance token holdings (DAO voting).

**Parameters:**
- `candidate: String` - Name of candidate/proposal

**Accounts Needed:**
- `voter` (signer)
- `election`
- `election_config`
- `voter_token_account` (for the governance token)
- `token_mint` (the governance token)
- `token_program`

**Access Control:** Anyone holding sufficient tokens

**Constraints:**
- Token voting must be enabled (`config.allow_token_voting == true`)
- Election must be started
- Election must not be ended
- Voter's token balance >= `config.min_token_balance`

**Voting Weight:** Uses voter's current token balance (real-time)

**Note:** No whitelist needed; no voting power tokens minted in this path

**Example:**
```typescript
const tokenBalance = 500;  // Has 500 governance tokens

await program.methods
  .castVoteWithToken("Proposal: Increase Treasury")
  .accounts({
    voter: daoMemberPubkey,
    election: electionPda,
    electionConfig: configPda,
    voterTokenAccount: memberTokenAtaPda,
    tokenMint: govTokenMintPda,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();

// Vote counts with weight = 500
```

---

#### `delegate_vote()`
Delegates voter's voting power to another whitelisted voter.

**Parameters:** None

**Accounts Needed:**
- `voter` (signer - person delegating)
- `election`
- `election_config`
- `voter_registry` (the delegator)
- `delegate_registry` (the delegate - must be whitelisted)

**Access Control:** Only whitelisted voters can delegate

**Constraints:**
- `allow_delegation` must be true
- Voter must be whitelisted
- Voter must not have voted yet
- Delegate must be whitelisted

**Side Effects:**
- Sets `voter_registry.delegated_to = Some(delegate_pubkey)`
- Voter cannot call `cast_vote()` afterward (prevented by `CannotVoteIfDelegated` check)

**How It Works:**
1. Voter calls `delegate_vote()`
2. System sets `delegated_to = delegate_address`
3. Delegate can now vote with combined weight (their own + delegator's)
4. Delegator cannot vote directly

**Example:**
```typescript
// Bob delegates to Alice
await program.methods
  .delegateVote()
  .accounts({
    voter: bobPubkey,           // Delegator
    election: electionPda,
    electionConfig: configPda,
    voterRegistry: bobRegistryPda,
    delegateRegistry: aliceRegistryPda,  // Delegate
  })
  .rpc();

// Now Alice votes with her weight + Bob's weight
await program.methods
  .castVote("Alice for President")
  .accounts({
    voter: alicePubkey,  // Alice voting
    // Alice's weight: 50
    // Bob's delegated weight: 25
    // Total vote weight: 75
  })
  .rpc();
```

---

## Data Structures Reference

### `Election`
Stores core election metadata.

```rust
pub struct Election {
    pub authority: Pubkey,      // Election creator
    pub title: String,          // Election name
    pub start_time: i64,        // Unix timestamp
    pub end_time: i64,          // Unix timestamp
    pub sbt_mint: Pubkey,       // Token mint for voting tokens
    pub bump: u8,               // PDA bump seed
    pub total_weight: u64,      // Sum of all voter weights
    pub denom_factor: u64,      // For quorum calculation
}
```

**PDA Derivation:**
```
seeds: [b"election", authority_pubkey, title_bytes]
```

---

### `ElectionConfig`
Stores governance parameters.

```rust
pub struct ElectionConfig {
    pub election: Pubkey,           // Link to election
    pub default_voter_weight: u64,  // Default if not specified
    pub quorum_percentage: u8,      // 1-100
    pub max_free_vote_changes: u8,  // Number of free changes
    pub price_per_vote_change: u64, // Fee in lamports
    pub allow_delegation: bool,     // Can voters delegate?
    pub allow_token_voting: bool,   // DAO voting enabled?
    pub token_mint: Option<Pubkey>, // DAO token (if enabled)
    pub min_token_balance: u64,     // Min tokens for DAO voting
}
```

**PDA Derivation:**
```
seeds: [b"config", election_pubkey]
```

---

### `VoterRegistry`
Tracks individual voter state.

```rust
pub struct VoterRegistry {
    pub election: Pubkey,        // Link to election
    pub voter: Pubkey,           // Voter's address
    pub weight: u64,             // Voting power
    pub is_whitelisted: bool,    // Can participate?
    pub has_voted: bool,         // Has cast a vote?
    pub current_vote: Option<String>,   // Their vote choice
    pub vote_changes_used: u8,   // Number of changes so far
    pub delegated_to: Option<Pubkey>,   // If delegated, to whom?
    pub bump: u8,                // PDA bump
}
```

**PDA Derivation:**
```
seeds: [b"voter_registry", election_pubkey, voter_pubkey]
```

---

### `VoteCast` Event
Emitted whenever a vote is cast or changed.

```rust
pub struct VoteCast {
    pub voter: Pubkey,          // Who voted
    pub candidate: String,      // Their choice
    pub weight: u64,            // How many votes
    pub timestamp: i64,         // When voted
    pub vote_change_number: u8, // Which version of vote
}
```

**Usage in Off-Chain Tallying:**
```javascript
// Get final vote per voter (highest change_number)
const finalVotes = {};
for (const event of allVoteCastEvents) {
  const voter = event.data.voter.toString();
  if (!finalVotes[voter] || 
      event.data.vote_change_number > finalVotes[voter].changeNum) {
    finalVotes[voter] = {
      candidate: event.data.candidate,
      weight: event.data.weight,
      changeNum: event.data.vote_change_number,
    };
  }
}

// Tally
const results = {};
for (const record of Object.values(finalVotes)) {
  const candidate = record.candidate;
  results[candidate] = (results[candidate] || 0) + record.weight;
}
```

---

## Error Codes Reference

| Code | Name | Meaning | Resolution |
|------|------|---------|-----------|
| 6000 | `ElectionNotStarted` | Voting hasn't begun | Wait for `start_time` |
| 6001 | `ElectionEnded` | Voting is over | Wait for next election |
| 6002 | `NoVotingPower` | No tokens to vote with | Administrator registers voter |
| 6003 | `InvalidQuorumPercentage` | Config has bad quorum | Set quorum to 1-100 |
| 6004 | `NotWhitelisted` | Voter not registered | Authority registers voter first |
| 6005 | `AlreadyVoted` | Voter voted in this election | Cannot vote twice (delegate instead) |
| 6006 | `CannotVoteIfDelegated` | Voter delegated their vote | Cannot vote if delegated |
| 6007 | `DelegationNotAllowed` | Delegation is disabled | Enable delegation in config |
| 6008 | `DelegateNotWhitelisted` | Delegate is not registered | Register delegate first |
| 6009 | `WeightMismatch` | Token weight ≠ registry weight | Contact administrator |
| 6010 | `TokenVotingNotEnabled` | DAO voting is disabled | Enable token voting first |
| 6011 | `InsufficientTokenBalance` | Don't have min tokens | Get more governance tokens |

---

## PDA Reference

### All PDAs Deterministically Derived

**Election PDA:**
```
Seed: [b"election", authority_pubkey, title_bytes]
Program: boat_final
```

**Config PDA:**
```
Seed: [b"config", election_pubkey]
Program: boat_final
```

**Voting Mint PDA:**
```
Seed: [b"mint", election_pubkey]
Program: boat_final
```

**Voter Registry PDA:**
```
Seed: [b"voter_registry", election_pubkey, voter_pubkey]
Program: boat_final
```

---

## Common Integration Patterns

### Pattern 1: Create Election & Register Voters

```typescript
// 1. Initialize
const electionPda = await initializeElection(title, start, end);

// 2. Configure (optional)
await setElectionConfig(1, 33, 2, 5_000_000, true);

// 3. Register voters
for (const voter of voters) {
  await registerVoter(voter.address, voter.weight);
}

// 4. Wait for start_time...
// 5. Voting begins
```

### Pattern 2: Query & Tally Results

```typescript
// Get all vote events
const events = await program.getEventEmitter()
  .getEvents()
  .filter(e => e.name === "VoteCast");

// Sort by voter and get final vote
const finalVotes = {};
for (const e of events) {
  const key = e.voter.toString();
  if (!finalVotes[key] || e.vote_change_number > finalVotes[key].changeNumber) {
    finalVotes[key] = e;
  }
}

// Tally
const results = {};
for (const record of Object.values(finalVotes)) {
  results[record.candidate] = (results[record.candidate] || 0) + record.weight;
}

// Determine winner
const winner = Object.entries(results)
  .sort(([,a], [,b]) => b - a)[0];
```

### Pattern 3: Enable DAO Voting

```typescript
// Create election
const electionPda = await initializeElection(title, start, end);

// Enable token voting (skip register_voter)
await enableTokenVoting(minBalance);

// DAO members vote directly with their token balance
const memberBalance = 500;
await castVoteWithToken("Proposal X");  // Votes with weight 500
```

---

## Gas Estimation

| Operation | Compute Units | Cost (5μ) | Cost (20μ) |
|-----------|---------------|-----------|-----------|
| Initialize | 5,000 | 0.025 SOL | 0.1 SOL |
| Register Voter | 8,000 | 0.04 SOL | 0.16 SOL |
| First Vote | 6,000 | 0.03 SOL | 0.12 SOL |
| Vote Change (free) | 6,000 | 0.03 SOL | 0.12 SOL |
| Vote Change (paid) | 6,500 | 0.0325 SOL | 0.13 SOL |
| Delegate Vote | 4,000 | 0.02 SOL | 0.08 SOL |

---

## Deployment Checklist

- [ ] Build contract (`anchor build`)
- [ ] Deploy to devnet (`anchor deploy --provider.cluster devnet`)
- [ ] Note program ID from deployment
- [ ] Create test election
- [ ] Register test voters
- [ ] Test voting flow
- [ ] Test delegation
- [ ] Test vote changes
- [ ] Test error conditions
- [ ] Verify events emitted
- [ ] Test off-chain tallying
- [ ] Document election configuration
- [ ] Package for production

---

## Support & Troubleshooting

### "NotWhitelisted" Error
**Problem:** Voter not in whitelist  
**Solution:** Call `register_voter()` first with authority

### "AlreadyVoted" Error
**Problem:** Voter tried to delegate after voting  
**Solution:** Delegate before first vote, or allow vote changes instead

### "InsufficientTokenBalance" Error
**Problem:** Voter doesn't have minimum tokens for DAO voting  
**Solution:** Acquire more governance tokens or lower `min_token_balance`

### Events Not Showing Up
**Problem:** Vote events not indexed  
**Solution:** Wait a bit for indexer, or use Anchor's event emitter directly

### Off-Chain Tallying Mismatch
**Problem:** Results don't add up  
**Solution:** Ensure counting only `max(vote_change_number)` per voter

---

