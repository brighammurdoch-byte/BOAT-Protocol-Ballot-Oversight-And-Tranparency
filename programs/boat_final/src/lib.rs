use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface}, 
    token_2022::{self, Burn, MintTo},
};

// ⚠️ REPLACE THIS WITH YOUR NEW PROGRAM ID
// (The one starting with 3Arq... that you saw in the logs)
declare_id!("EWatwsCrcnLninbUQV6yJzFreJHVhCnSm6LxB7aooHvg");

/// # BOAT Protocol (Ballot Oversight and Transparency)
///
/// This smart contract acts as a digital, immutable ballot box for corporate governance and elections.
///
/// ## Core Financial Concepts for Finance Students
/// 1. **The Mint (Ballot Printer):** When an election is created, a unique "Mint" is established.
///    Think of this as a central bank for a specific election that issues "Voting Rights" tokens.
///
/// 2. **Registration (Issuance):** The election administrator "mints" (issues) tokens to eligible voters.
///    - 1 Token = 1 Vote (or weighted voting power, e.g., 1 share = 1 vote).
///    - These tokens act as "Bearer Assets" for the right to vote.
///
/// 3. **Voting (Redemption):** To cast a vote, the voter must "burn" (destroy) their token.
///    - This ensures **Double-Spending Protection**: You cannot vote twice because your "voting right"
///      asset is destroyed in the process of voting.
///    - The vote is recorded permanently on the blockchain (the public ledger).
#[program]
pub mod boat_final {
    use super::*;

    /// ## Initialize Election
    /// Sets up the governance parameters (Corporate Charter for this vote).
    ///
    /// - **Authority:** The entity (e.g., Corporate Secretary) allowed to issue ballots.
    /// - **Mint:** Creates the cryptographic "printing press" for the voting tokens.
    /// - **Dates:** Enforces strict start and end times for the voting period.
    pub fn initialize_election(
        ctx: Context<InitializeElection>,
        title: String,
        start_time: i64,
        end_time: i64,
    ) -> Result<()> {
        let election = &mut ctx.accounts.election;
        election.authority = ctx.accounts.authority.key();
        election.title = title;
        election.start_time = start_time;
        election.end_time = end_time;
        election.sbt_mint = ctx.accounts.sbt_mint.key();
        election.bump = ctx.bumps.election;
        
        msg!("Election Initialized: {}", election.title);
        Ok(())
    }

    /// ## Register Voter (Issue Ballot)
    /// The administrator issues voting power to a specific stakeholder.
    ///
    /// - **Minting:** New tokens are created and sent to the voter's digital wallet.
    /// - **Weight:** Allows for weighted voting (e.g., a shareholder with 100 shares gets 100 voting tokens).
    ///
    /// *Financial Analogy:* Issuing stock certificates to shareholders.
    pub fn register_voter(ctx: Context<RegisterVoter>, weight: u64) -> Result<()> {
        // --- FIX IS HERE ---
        // 1. Save the key to a variable so it stays alive
        let authority_key = ctx.accounts.authority.key();
        let bump = [ctx.accounts.election.bump];
        
        let seeds = &[
            b"election",
            authority_key.as_ref(), // 2. Reference the variable
            ctx.accounts.election.title.as_bytes(),
            &bump,
        ];
        let signer = &[&seeds[..]];

        token_2022::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.sbt_mint.to_account_info(),
                    to: ctx.accounts.voter_token_account.to_account_info(),
                    authority: ctx.accounts.election.to_account_info(),
                },
                signer,
            ),
            weight,
        )?;

        msg!("Voter Registered with Weight: {}", weight);
        Ok(())
    }

    /// ## Cast Vote (Exercise Right)
    /// The voter submits their choice, and their voting tokens are destroyed.
    ///
    /// - **Burning:** The tokens are removed from circulation. This mathematically guarantees
    ///   that the same tokens cannot be used again.
    /// - **Audit Trail:** An event (`VoteCast`) is emitted, acting as a permanent public record.
    ///
    /// *Financial Analogy:* Redeeming a coupon or exercising a stock option. Once used, it's gone.
    pub fn cast_vote(ctx: Context<CastVote>, candidate: String) -> Result<()> {
        let election = &ctx.accounts.election;
        let clock = Clock::get()?;

        require!(clock.unix_timestamp >= election.start_time, ErrorCode::ElectionNotStarted);
        require!(clock.unix_timestamp <= election.end_time, ErrorCode::ElectionEnded);

        let user_weight = ctx.accounts.voter_token_account.amount;
        require!(user_weight > 0, ErrorCode::NoVotingPower);

        token_2022::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.sbt_mint.to_account_info(),
                    from: ctx.accounts.voter_token_account.to_account_info(),
                    authority: ctx.accounts.voter.to_account_info(),
                },
            ),
            user_weight,
        )?;

        msg!("Vote recorded for: {}", candidate);

        emit!(VoteCast {
            voter: ctx.accounts.voter.key(),
            candidate,
            weight: user_weight,
        });

        Ok(())
    }
}

// --- DATA STRUCTURES ---

/// The "Ballot Box" account storing election metadata.
#[account]
pub struct Election {
    pub authority: Pubkey,
    pub title: String,
    pub start_time: i64,
    pub end_time: i64,
    pub sbt_mint: Pubkey,
    pub bump: u8,
}

/// The "Ticker Tape" event. This is the public record of a vote being cast.
#[event]
pub struct VoteCast {
    pub voter: Pubkey,
    pub candidate: String,
    pub weight: u64,
}

/// Security Context for Initializing an Election
#[derive(Accounts)]
#[instruction(title: String)]
pub struct InitializeElection<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    // This account is a PDA (Program Derived Address).
    // It is deterministically derived from "election" + authority + title.
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + (4 + title.len()) + 8 + 8 + 32 + 1,
        seeds = [b"election", authority.key().as_ref(), title.as_bytes()],
        bump
    )]
    pub election: Account<'info, Election>,

    // The "Mint" (Token Printer) is also a PDA, owned by the Election account.
    #[account(
        init,
        payer = authority,
        seeds = [b"mint", election.key().as_ref()],
        bump,
        mint::decimals = 0,
        mint::authority = election,
        mint::freeze_authority = election,
        mint::token_program = token_program
    )]
    pub sbt_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub rent: Sysvar<'info, Rent>,
}

/// Security Context for Registering a Voter
#[derive(Accounts)]
pub struct RegisterVoter<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut, has_one = authority, has_one = sbt_mint)]
    pub election: Account<'info, Election>,

    #[account(mut)]
    pub sbt_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Safe
    #[account(mut)]
    pub voter: UncheckedAccount<'info>, 

    // Create a Token Account (Wallet) for the voter to hold their ballot tokens.
    #[account(
        init,
        payer = authority,
        associated_token::mint = sbt_mint,
        associated_token::authority = voter,
        associated_token::token_program = token_program
    )]
    pub voter_token_account: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Security Context for Casting a Vote
#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(mut)]
    pub election: Account<'info, Election>,
    #[account(mut)]
    pub sbt_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = sbt_mint,
        associated_token::authority = voter,
        associated_token::token_program = token_program
    )]
    pub voter_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Election has not started yet.")]
    ElectionNotStarted,
    #[msg("Election is already over.")]
    ElectionEnded,
    #[msg("You have no voting tokens remaining.")]
    NoVotingPower,
}