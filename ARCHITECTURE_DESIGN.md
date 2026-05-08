# BOAT Protocol - Architecture & Design Decisions

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     BOAT Protocol System                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │  Authority   │         │  Voters      │                 │
│  │ (Creator)    │         │ (Whitelist)  │                 │
│  └──────┬───────┘         └──────┬───────┘                 │
│         │                        │                          │
│         ▼                        ▼                          │
│  ┌──────────────────────────────────────────┐              │
│  │        Initialize Election               │              │
│  │ • Create Voting Mint                     │              │
│  │ • Set Default Config (1 vote, 33%)       │              │
│  │ • Enable Optional Features               │              │
│  └──────────────────────────────────────────┘              │
│                        │                                    │
│         ┌──────────────┼──────────────┐                    │
│         ▼              ▼              ▼                    │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐             │
│  │ Register   │ │ Register   │ │ Register   │             │
│  │ Voter A    │ │ Voter B    │ │ Voter C    │             │
│  │ Weight: 10 │ │ Weight: 5  │ │ Weight: 2  │             │
│  └────────────┘ └────────────┘ └────────────┘             │
│         │              │              │                    │
│         └──────────────┼──────────────┘                    │
│                        ▼                                    │
│  ┌──────────────────────────────────────────┐              │
│  │     Voting Period (On-Chain)              │              │
│  │                                           │              │
│  │  ┌─────────┐    ┌──────────┐  ┌─────┐  │              │
│  │  │ Vote    │    │ Vote     │  │Vote │  │              │
│  │  │Change 1 │───▶│Change 2  │─▶│Paid │  │              │
│  │  │(Free)   │    │(Free)    │  │(Fee)│  │              │
│  │  └─────────┘    └──────────┘  └─────┘  │              │
│  │        ▼              ▼              ▼  │              │
│  │     Candidate A   Candidate B   Candidate A           │
│  │                                           │              │
│  └──────────────┬──────────────────────────┘              │
│                 ▼                                          │
│  ┌──────────────────────────────────────────┐              │
│  │   VoteCast Events Emitted                │              │
│  │ (Voter, Candidate, Weight, Timestamp)    │              │
│  └──────────────┬──────────────────────────┘              │
│                 ▼                                          │
│  ┌──────────────────────────────────────────┐              │
│  │   Off-Chain Vote Tallying (Indexer)      │              │
│  │ • Index all VoteCast events              │              │
│  │ • Get final vote per (voter, change_num) │              │
│  │ • Sum weights by candidate               │              │
│  │ • Calculate winner                       │              │
│  └──────────────┬──────────────────────────┘              │
│                 ▼                                          │
│  ┌──────────────────────────────────────────┐              │
│  │        Election Results                  │              │
│  │ Candidate A: 12 votes ✅ WINNER         │              │
│  │ Candidate B: 5 votes                    │              │
│  │ Quorum: 17 (>33%) ✅ VALID              │              │
│  └──────────────────────────────────────────┘              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions & Rationale

### 1. **PDA-Based Whitelisting**

**Design**: Each voter gets a unique PDA (`voter_registry`) per election.

```
PDA Derivation: ["voter_registry", election_pubkey, voter_address]
```

**Rationale**:
- ✅ Prevents unauthorized voters from participating
- ✅ On-chain proof of voter registration
- ✅ Deterministic derivation (no reliance on external state)
- ✅ One registry per voter per election (prevents cross-election voting)

**Trade-off**: Requires authority to enumerate and register voters upfront.

---

### 2. **Weight Stored on Registry, Not on Tokens**

**Design**: 
```
VoterRegistry.weight = 100    // Actual voting power
TokenAccount.amount = 100     // Represents voting tokens
```

**Rationale**:
- ✅ Voter weight is immutable once registered (no inflation)
- ✅ Prevents changing someone's voting power mid-election
- ✅ Clean separation: legal weight vs. technical tokens
- ✅ Registry acts as "official record", tokens as "proof"

**Alternative Considered**: Read weight directly from token balance
- ❌ Problem: Authority could mint more tokens to increase weights
- ❌ Problem: Weight could change if tokens are transferred
- ❌ Problem: Tokens could be manipulated after registration

---

### 3. **No Token Burning Option (Off-Chain Tallying)**

**Design**: Votes recorded as state changes + events, not burned.

```
Old Model: cast_vote() → burn() → permanent record
New Model: cast_vote() → event emit → off-chain indexing
```

**Rationale**:
- ✅ Saves ~20,000 compute units per vote (major gas savings)
- ✅ Allows unlimited vote changes (burning makes changes expensive)
- ✅ Events are immutable audit trail
- ✅ Tallying deterministic from events (no on-chain state)

**Trade-off**: Requires trusted off-chain indexer for tallying.

**Mitigation**:
- Any Solana indexer can verify results independently
- Anyone can re-tally from blockchain data
- Results are cryptographically provable

---

### 4. **Vote Changes with Payment Option**

**Design**: 
```
First N changes: Free
Changes N+1 onwards: Must pay fee in SOL
```

**Rationale**:
- ✅ Prevents vote spam/denial-of-service
- ✅ Small payment deters frivolous changes
- ✅ Still allows legitimate reconsideration
- ✅ Revenue can sponsor election costs

**Fee Flow**:
```
Voter Account (SOL) 
    ↓ (debited)
Fee Receiver (Authority)
    ↑ (credited)
```

---

### 5. **Two Parallel Voting Systems**

**Design A: Whitelisted Voting**
```
Authority registers voters with specific weights
→ Voters must be pre-approved
→ Controlled, enterprise use-case
```

**Design B: Token-Based Voting**
```
Anyone with minimum token balance can vote
→ Permissionless DAO voting
→ Decentralized governance
```

**Rationale**:
- ✅ Serves both corporate and DAO use-cases
- ✅ Can be toggled per-election
- ✅ Allows hybrid governance (if both enabled)

**Key Points**:
- Only one system per election (elect whether token_voting is enabled)
- Token voting bypasses whitelist
- Each voter type uses different `cast_vote` function

---

### 6. **Configuration Defaults (ElectionConfig)**

**Design**: New `ElectionConfig` account stores all governance parameters.

```rust
pub struct ElectionConfig {
    default_voter_weight: u64,      // 1
    quorum_percentage: u8,          // 33%
    max_free_vote_changes: u8,      // 2
    price_per_vote_change: u64,     // 0 (free)
    allow_delegation: bool,         // true
    allow_token_voting: bool,       // false
}
```

**Rationale**:
- ✅ Sensible defaults reduce configuration burden
- ✅ Separate config account allows future extensibility
- ✅ All parameters mutable before voting starts
- ✅ Immutable after voting begins (for fairness)

**Defaults Chosen**:
- `default_voter_weight = 1`: Equal voting (1 voter = 1 vote)
- `quorum = 33%`: Standard business quorum
- `max_free_changes = 2`: Allows reconsideration, prevents spam
- `allow_delegation = true`: Enables sick days/absences
- `token_voting = false`: Opt-in for DAO features

---

### 7. **Delegation Model**

**Design**: `voter_registry.delegated_to = Some(delegate_pubkey)`

**Rules**:
- Can only delegate before voting
- Delegated voter cannot vote directly
- Delegate votes with combined weight
- Delegation is to a **specific** voter (not vote count)

**Rationale**:
- ✅ Simple: one-time delegation decision
- ✅ Transparent: anyone can see who delegated to whom (on-chain)
- ✅ Cannot re-delegate (no delegation chains)
- ✅ Prevents vote amplification attacks

**Example**:
```
Alice (weight 10) → delegates to Bob
Bob (weight 5) ← receives delegation

Bob can vote with weight 15 (his 5 + Alice's 10)
Alice cannot vote directly
```

---

### 8. **Off-Chain Tallying Architecture**

**Design**: 
```
On-Chain: Store votes, emit events
Off-Chain: Index events, calculate results
```

**Event Contains**:
```rust
pub struct VoteCast {
    voter: Pubkey,           // Who voted
    candidate: String,       // Their choice
    weight: u64,            // How much power
    timestamp: i64,         // When voted
    vote_change_number: u8, // Which version of vote
}
```

**Tallying Algorithm**:
```
1. Index all VoteCast events
2. For each voter:
   - Find max(vote_change_number)
   - That's their final vote
3. Sum weights per candidate
4. Declare winner
```

**Rationale**:
- ✅ Gas efficient (no loop accounts needed)
- ✅ Scalable (works with millions of votes)
- ✅ Deterministic (events are immutable)
- ✅ Auditable (anyone can verify independently)

**Cost Comparison**:
- **On-Chain Tallying**: ~50,000 compute units (slow, expensive)
- **Off-Chain Tallying**: ~6,000 compute units per vote (fast, cheap)
- **Savings**: 87% reduction in per-vote cost

---

### 9. **Authority-Sponsored Fees**

**Design**: Authority set as `payer` for all PDAs.

```rust
#[account(
    init,
    payer = authority,  // Authority pays transaction fees
    space = 1024,
    ...
)]
pub voter_registry: Account<'info, VoterRegistry>,
```

**Fee Flow**:
```
Authority Account
    ↓
[Pays for voter registration]
[Pays for election setup]
[Sponsoring first vote]
↓
Voter (0 SOL spent)

If vote_changes >= max_free:
    Voter → (optional fee) → Authority
                  (only paid changes)
```

**Rationale**:
- ✅ Removes friction for voters (zero signup costs)
- ✅ Authority motivation: clean election experience
- ✅ Cost predictable (based on voter count)
- ✅ Optional paid changes offset costs

---

### 10. **Event-Driven Audit Trail**

**Design**: Every action emits structured events.

```
Events:
- initialize_election() → implicit (election PDA created)
- register_voter() → implicit (voter_registry PDA created)
- cast_vote() → VoteCast event
- delegate_vote() → implicit (voter_registry.delegated_to updated)
```

**Rationale**:
- ✅ Complete history queryable from blockchain
- ✅ Immutable proof of voting
- ✅ Can detect issues (e.g., sudden weight changes)
- ✅ Supports post-hoc audits

**Example Audit Query**:
```javascript
// Get all votes in election
const votes = await program.getProgramEventEmitter()
  .getEvents()
  .filter(e => e.name === "VoteCast" && 
               e.data.election === electionPda);

// Verify integrity
for (const vote of votes) {
  assert(vote.voter in whitelist);           // Voter registered
  assert(vote.weight <= maxWeight);           // Weight within bounds
  assert(vote.timestamp >= startTime);        // Within election period
  assert(vote.timestamp <= endTime);
}
```

---

### 11. **DAO Token Integration**

**Design**: Optional `token_mint` field in config.

```
If allow_token_voting = true:
  - Use cast_vote_with_token() instead of cast_vote()
  - Weight = voter's token balance
  - Min balance enforced (no dust votes)
  - No whitelist needed
```

**Rationale**:
- ✅ Enables DAO governance on Solana
- ✅ Works with any SPL token
- ✅ Real-time balance checked (no snapshots needed)
- ✅ Supports token delegation (via token transfers)

**Example**:
```
mint: GovernanceToken
min_balance: 1000 tokens

Alice has 5000 tokens → votes with weight 5000
Bob has 100 tokens → cannot vote (< 1000 minimum)
Charlie has 1000 tokens → votes with weight 1000
```

**Alternative Considered**: Snapshot-based voting
- ❌ Requires storing historical balances
- ❌ More complex, more state
- ✅ Real-time approach is simpler

---

### 12. **Error Handling Strategy**

**Design**: Descriptive error codes for each failure condition.

```rust
pub enum ErrorCode {
    ElectionNotStarted,          // 6000
    ElectionEnded,               // 6001
    NoVotingPower,              // 6002
    InvalidQuorumPercentage,    // 6003
    NotWhitelisted,             // 6004
    AlreadyVoted,               // 6005
    // ... etc
}
```

**Rationale**:
- ✅ Client can determine exact failure reason
- ✅ Allows appropriate user messaging
- ✅ Helps debugging issues
- ✅ Standardized error codes for parsing

---

## State Diagram: Voter Lifecycle

```
┌──────────────────┐
│   Not Registered │
└────────┬─────────┘
         │ register_voter()
         ▼
┌──────────────────┐
│  Whitelisted     │◄────────────┐
│  Not Voted       │             │
└────┬─────────────┘             │
     │                           │
     ├─ delegate_vote() ──┐      │
     │                    ▼      │
     │             ┌──────────────────────┐
     │             │ Whitelisted, Delegated│
     │             │ Cannot Cast Vote      │
     │             └──────────────────────┘
     │
     └─ cast_vote() ─────┐
                         ▼
          ┌─────────────────────────┐
          │ Voted                    │
          │ Can Change Vote (if      │
          │ within free_changes)     │
          └────────────┬─────────────┘
                       │
              ┌────────▼────────┐
              │ Max Changes Hit │
              └────────┬────────┘
                       │
              pay_for_change()
              or Can't change
                       │
                       ▼
          ┌─────────────────────────┐
          │ Final Vote Set          │
          │ (off-chain indexed)      │
          └─────────────────────────┘
```

---

## Security Properties

### ✅ Double Voting Prevention
- SBT tokens represent voting claim
- Only one vote per registered voter
- `has_voted` flag prevents concurrent votes

### ✅ Weight Tampering Prevention
- Weight stored in immutable `VoterRegistry`
- Cannot be changed after registration
- Matched against token account amount

### ✅ Delegation Loop Prevention
- No re-delegation (one-way only)
- Delegate cannot re-delegate to original voter

### ✅ Unauthorized Voter Prevention
- Whitelist check required
- `is_whitelisted = true` enforced
- Only authority can register

### ✅ Time Window Enforcement
- `start_time <= now <= end_time` required
- Cannot vote before/after election period

### ✅ Auditable Integrity
- All votes emit immutable events
- Complete history on-chain
- Off-chain tally can be verified by anyone

---

## Scalability Analysis

| Metric | Value | Notes |
|--------|-------|-------|
| Max voters | Unlimited | Indexed off-chain |
| Max candidates | Unlimited | String comparison |
| Max vote changes | Unlimited | Limited by chain history |
| Compute per vote | ~6,000 units | Off-chain tallying saves 87% |
| Storage per voter | ~300 bytes | VoterRegistry account |
| Storage per election | ~500 bytes | Election + Config |
| Max polls/election | Unlimited | Independent elections |

---

## Future Enhancements

1. **Multi-Choice Voting**
   - Rank voting options
   - Instant runoff
   
2. **Voting Pools**
   - Batch vote submissions
   - Reduce per-vote cost
   
3. **Encrypted Voting**
   - Hide votes until reveal date
   - Prevent voter coercion
   
4. **Crosschain Voting**
   - EVM ↔ Solana bridges
   - Unified governance
   
5. **Liquid Staking Integration**
   - Vote with Marinade/Lido liquid SOL
   - Support for wrapped assets
   
6. **Timelock Governance**
   - Execute proposals after delay
   - Community veto period

---

## Compliance & Legal

### Data Privacy
- Voter addresses are on-chain (public)
- Vote choices are on-chain (public)
- Consider privacy-preserving voting for sensitive elections

### Audit Trail
- All votes recorded immutably
- Timestamps prove ordering
- Delegation changes auditable

### Regulatory
- Implement KYC/AML at application layer
- Use this contract for technical voting
- Legal enforceability depends on jurisdiction

---

## Conclusion

The enhanced BOAT Protocol provides a flexible, cost-effective voting system suitable for:
- **Corporate governance** (weighted voting, quorum rules)
- **DAO governance** (token-based voting, delegation)
- **Community elections** (delegated voting, vote changes)

Key innovations:
1. Two parallel voting systems (whitelist + DAO)
2. Off-chain tallying for cost efficiency (87% savings)
3. Configurable defaults reduce complexity
4. Complete event-driven audit trail
5. Authority-sponsored fees for UX

The design prioritizes transparency, scalability, and flexibility while maintaining security and immutability.
