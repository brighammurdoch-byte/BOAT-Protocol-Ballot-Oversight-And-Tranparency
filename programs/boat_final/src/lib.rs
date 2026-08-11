use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, MintTo, TokenAccount, TokenInterface},
};

declare_id!("HFr5VbxjxszddWUUaayzbxQ2onD6EzfNcCG2hTXQ8ga6");

/// Authority-only registration (USU MVP default).
pub const REGISTRATION_AUTHORITY_ONLY: u8 = 0;

#[program]
pub mod boat_final {
    use super::*;

    pub fn initialize_election(
        ctx: Context<InitializeElection>,
        title: String,
        start_time: i64,
        end_time: i64,
    ) -> Result<()> {
        require!(start_time < end_time, ErrorCode::InvalidElectionWindow);
        require!(title.len() > 0 && title.len() <= 64, ErrorCode::InvalidTitle);

        let election = &mut ctx.accounts.election;
        election.authority = ctx.accounts.authority.key();
        election.title = title;
        election.start_time = start_time;
        election.end_time = end_time;
        election.sbt_mint = ctx.accounts.sbt_mint.key();
        election.bump = ctx.bumps.election;
        election.total_weight = 0;
        election.denom_factor = 1;
        election.registered_voter_count = 0;
        election.outcome_count = 0;

        let config = &mut ctx.accounts.election_config;
        config.election = election.key();
        config.default_voter_weight = 1;
        config.quorum_percentage = 33;
        config.max_free_vote_changes = 2;
        config.price_per_vote_change = 0;
        config.allow_delegation = false;
        config.registration_mode = REGISTRATION_AUTHORITY_ONLY;
        config.max_registered_voters = 0;

        msg!("Election initialized: {}", election.title);
        Ok(())
    }

    /// Update election config. Frozen once voting has started.
    pub fn set_election_config(
        ctx: Context<SetElectionConfig>,
        default_voter_weight: u64,
        quorum_percentage: u8,
        max_free_vote_changes: u8,
        price_per_vote_change: u64,
        allow_delegation: bool,
    ) -> Result<()> {
        require!(
            quorum_percentage > 0 && quorum_percentage <= 100,
            ErrorCode::InvalidQuorumPercentage
        );

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp < ctx.accounts.election.start_time,
            ErrorCode::ElectionAlreadyStarted
        );

        let config = &mut ctx.accounts.election_config;
        config.default_voter_weight = default_voter_weight;
        config.quorum_percentage = quorum_percentage;
        config.max_free_vote_changes = max_free_vote_changes;
        config.price_per_vote_change = price_per_vote_change;
        config.allow_delegation = allow_delegation;

        msg!("Election config updated");
        Ok(())
    }

    /// Authority registers a voter and mints SBT weight tokens.
    pub fn register_voter(ctx: Context<RegisterVoter>, weight: u64) -> Result<()> {
        let config = &ctx.accounts.election_config;
        let weight = if weight == 0 {
            config.default_voter_weight
        } else {
            weight
        };

        let election = &mut ctx.accounts.election;
        if config.max_registered_voters > 0 {
            require!(
                election.registered_voter_count < config.max_registered_voters,
                ErrorCode::MaxVotersReached
            );
        }

        let voter_registry = &mut ctx.accounts.voter_registry;
        voter_registry.election = election.key();
        voter_registry.voter = ctx.accounts.voter.key();
        voter_registry.weight = weight;
        voter_registry.is_whitelisted = true;
        voter_registry.has_voted = false;
        voter_registry.current_vote = None;
        voter_registry.vote_changes_used = 0;
        voter_registry.delegated_to = None;
        voter_registry.bump = ctx.bumps.voter_registry;

        election.total_weight = election.total_weight.saturating_add(weight);
        election.registered_voter_count = election
            .registered_voter_count
            .checked_add(1)
            .ok_or(ErrorCode::MaxVotersReached)?;

        let title_bytes = election.title.as_bytes();
        let bump = election.bump;
        let authority_key = election.authority;
        let signer_seeds: &[&[&[u8]]] =
            &[&[b"election".as_ref(), authority_key.as_ref(), title_bytes, &[bump]]];
        let cpi_accounts = MintTo {
            mint: ctx.accounts.sbt_mint.to_account_info(),
            to: ctx.accounts.voter_token_account.to_account_info(),
            authority: election.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts)
            .with_signer(signer_seeds);
        token_interface::mint_to(cpi_ctx, weight)?;

        msg!(
            "Voter {} registered with weight {}",
            ctx.accounts.voter.key(),
            weight
        );
        Ok(())
    }

    /// Add a candidate. Must finish before `start_time`.
    pub fn add_outcome(
        ctx: Context<AddOutcome>,
        label: String,
        outcome_index: u8,
    ) -> Result<()> {
        require!(label.len() > 0 && label.len() <= 64, ErrorCode::LabelTooLong);
        let clock = Clock::get()?;
        let election = &mut ctx.accounts.election;
        require!(
            clock.unix_timestamp < election.start_time,
            ErrorCode::ElectionAlreadyStarted
        );

        let outcome = &mut ctx.accounts.outcome;
        let election_key = election.key();
        outcome.election = election_key;
        outcome.index = outcome_index;
        outcome.label = label.clone();
        outcome.bump = ctx.bumps.outcome;

        emit!(OutcomeAdded {
            election: election_key,
            index: outcome_index,
            label: label.clone(),
        });

        election.outcome_count = election
            .outcome_count
            .checked_add(1)
            .ok_or(ErrorCode::TooManyOutcomes)?;

        msg!("Outcome {} added: {}", outcome_index, label);
        Ok(())
    }

    /// Optional: mark that the voter delegated (blocks direct cast). Weight is NOT transferred.
    pub fn delegate_vote(ctx: Context<DelegateVote>) -> Result<()> {
        let config = &ctx.accounts.election_config;
        require!(config.allow_delegation, ErrorCode::DelegationNotAllowed);

        let voter_registry = &mut ctx.accounts.voter_registry;
        require!(voter_registry.is_whitelisted, ErrorCode::NotWhitelisted);
        require!(!voter_registry.has_voted, ErrorCode::AlreadyVoted);

        let delegate_registry = &ctx.accounts.delegate_registry;
        require!(
            delegate_registry.is_whitelisted,
            ErrorCode::DelegateNotWhitelisted
        );

        voter_registry.delegated_to = Some(delegate_registry.voter);
        msg!(
            "Vote delegated from {} to {}",
            voter_registry.voter,
            delegate_registry.voter
        );
        Ok(())
    }

    pub fn cast_vote(ctx: Context<CastVote>, outcome_index: u8) -> Result<()> {
        let election = &ctx.accounts.election;
        let clock = Clock::get()?;

        require!(election.outcome_count > 0, ErrorCode::NoOutcomesDefined);
        require!(
            clock.unix_timestamp >= election.start_time,
            ErrorCode::ElectionNotStarted
        );
        require!(
            clock.unix_timestamp <= election.end_time,
            ErrorCode::ElectionEnded
        );

        let outcome = &ctx.accounts.outcome;
        require!(outcome.index == outcome_index, ErrorCode::InvalidOutcome);
        let candidate_label = outcome.label.clone();

        let voter_registry = &mut ctx.accounts.voter_registry;
        require!(voter_registry.is_whitelisted, ErrorCode::NotWhitelisted);
        require!(
            voter_registry.delegated_to.is_none(),
            ErrorCode::CannotVoteIfDelegated
        );

        let user_weight = ctx.accounts.voter_token_account.amount;
        require!(user_weight > 0, ErrorCode::NoVotingPower);
        require!(user_weight == voter_registry.weight, ErrorCode::WeightMismatch);

        if voter_registry.has_voted {
            let config = &ctx.accounts.election_config;
            if voter_registry.vote_changes_used >= config.max_free_vote_changes
                && config.price_per_vote_change > 0
            {
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.key(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.voter.to_account_info(),
                        to: ctx.accounts.fee_receiver.to_account_info(),
                    },
                );
                anchor_lang::system_program::transfer(cpi_context, config.price_per_vote_change)?;
            }
            voter_registry.vote_changes_used = voter_registry.vote_changes_used.saturating_add(1);
        }

        voter_registry.current_vote = Some(candidate_label.clone());
        voter_registry.has_voted = true;

        emit!(VoteCast {
            election: election.key(),
            voter: voter_registry.voter,
            candidate: candidate_label,
            weight: user_weight,
            timestamp: clock.unix_timestamp,
            vote_change_number: voter_registry.vote_changes_used,
        });

        Ok(())
    }
}

#[account]
pub struct Election {
    pub authority: Pubkey,
    pub title: String,
    pub start_time: i64,
    pub end_time: i64,
    pub sbt_mint: Pubkey,
    pub bump: u8,
    pub total_weight: u64,
    pub denom_factor: u64,
    pub registered_voter_count: u32,
    pub outcome_count: u8,
}

#[account]
pub struct ElectionConfig {
    pub election: Pubkey,
    pub default_voter_weight: u64,
    pub quorum_percentage: u8,
    pub max_free_vote_changes: u8,
    pub price_per_vote_change: u64,
    pub allow_delegation: bool,
    pub registration_mode: u8,
    pub max_registered_voters: u32,
}

#[account]
#[derive(Default)]
pub struct ElectionOutcome {
    pub election: Pubkey,
    pub index: u8,
    pub label: String,
    pub bump: u8,
}

#[account]
#[derive(Default)]
pub struct VoterRegistry {
    pub election: Pubkey,
    pub voter: Pubkey,
    pub weight: u64,
    pub is_whitelisted: bool,
    pub has_voted: bool,
    pub current_vote: Option<String>,
    pub vote_changes_used: u8,
    pub delegated_to: Option<Pubkey>,
    pub bump: u8,
}

#[event]
pub struct VoteCast {
    pub election: Pubkey,
    pub voter: Pubkey,
    pub candidate: String,
    pub weight: u64,
    pub timestamp: i64,
    pub vote_change_number: u8,
}

#[event]
pub struct OutcomeAdded {
    pub election: Pubkey,
    pub index: u8,
    pub label: String,
}

#[derive(Accounts)]
#[instruction(title: String)]
pub struct InitializeElection<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + (4 + title.len()) + 8 + 8 + 32 + 1 + 8 + 8 + 4 + 1,
        seeds = [b"election", authority.key().as_ref(), title.as_bytes()],
        bump
    )]
    pub election: Account<'info, Election>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 8 + 1 + 1 + 8 + 1 + 1 + 4,
        seeds = [b"config", election.key().as_ref()],
        bump
    )]
    pub election_config: Account<'info, ElectionConfig>,

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

#[derive(Accounts)]
pub struct SetElectionConfig<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = authority)]
    pub election: Account<'info, Election>,

    #[account(mut, has_one = election)]
    pub election_config: Account<'info, ElectionConfig>,
}

#[derive(Accounts)]
pub struct RegisterVoter<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, has_one = authority, has_one = sbt_mint)]
    pub election: Account<'info, Election>,

    #[account(has_one = election)]
    pub election_config: Account<'info, ElectionConfig>,

    #[account(mut)]
    pub sbt_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: voter pubkey used only for PDA seeds and as ATA authority
    pub voter: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 8 + 1 + 1 + (1 + 4 + 100) + 1 + (1 + 32) + 1,
        seeds = [b"voter_registry", election.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub voter_registry: Account<'info, VoterRegistry>,

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

#[derive(Accounts)]
#[instruction(label: String, outcome_index: u8)]
pub struct AddOutcome<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority,
        constraint = election.outcome_count == outcome_index @ ErrorCode::InvalidOutcomeIndex
    )]
    pub election: Account<'info, Election>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 1 + (4 + 64) + 1,
        seeds = [b"outcome", election.key().as_ref(), &[outcome_index]],
        bump
    )]
    pub outcome: Account<'info, ElectionOutcome>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateVote<'info> {
    pub voter: Signer<'info>,
    pub election: Account<'info, Election>,

    #[account(has_one = election)]
    pub election_config: Account<'info, ElectionConfig>,

    #[account(mut, has_one = election, has_one = voter)]
    pub voter_registry: Account<'info, VoterRegistry>,

    #[account(has_one = election)]
    pub delegate_registry: Account<'info, VoterRegistry>,
}

#[derive(Accounts)]
#[instruction(outcome_index: u8)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    /// CHECK: receives optional vote-change fee (may be the voter)
    #[account(mut)]
    pub fee_receiver: UncheckedAccount<'info>,

    pub election: Account<'info, Election>,

    #[account(has_one = election)]
    pub election_config: Account<'info, ElectionConfig>,

    #[account(constraint = sbt_mint.key() == election.sbt_mint @ ErrorCode::InvalidMint)]
    pub sbt_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, has_one = election, has_one = voter)]
    pub voter_registry: Account<'info, VoterRegistry>,

    #[account(
        associated_token::mint = sbt_mint,
        associated_token::authority = voter,
        associated_token::token_program = token_program
    )]
    pub voter_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"outcome", election.key().as_ref(), &[outcome_index]],
        bump = outcome.bump,
        constraint = outcome.election == election.key() @ ErrorCode::InvalidOutcome,
        constraint = outcome.index == outcome_index @ ErrorCode::InvalidOutcome
    )]
    pub outcome: Account<'info, ElectionOutcome>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Election has not started yet.")]
    ElectionNotStarted,
    #[msg("Election is already over.")]
    ElectionEnded,
    #[msg("You have no voting tokens remaining.")]
    NoVotingPower,
    #[msg("Invalid quorum percentage (must be 1-100).")]
    InvalidQuorumPercentage,
    #[msg("Voter is not whitelisted.")]
    NotWhitelisted,
    #[msg("Voter has already cast a vote.")]
    AlreadyVoted,
    #[msg("Voter has delegated their vote and cannot vote directly.")]
    CannotVoteIfDelegated,
    #[msg("Delegation is not allowed for this election.")]
    DelegationNotAllowed,
    #[msg("Delegate is not whitelisted.")]
    DelegateNotWhitelisted,
    #[msg("Voting weight does not match registry.")]
    WeightMismatch,
    #[msg("Max registered voters reached.")]
    MaxVotersReached,
    #[msg("Invalid outcome.")]
    InvalidOutcome,
    #[msg("No outcomes defined for this election.")]
    NoOutcomesDefined,
    #[msg("Voting has already started.")]
    ElectionAlreadyStarted,
    #[msg("Outcome label too long or empty.")]
    LabelTooLong,
    #[msg("Invalid outcome index.")]
    InvalidOutcomeIndex,
    #[msg("Too many outcomes.")]
    TooManyOutcomes,
    #[msg("Invalid election title.")]
    InvalidTitle,
    #[msg("Invalid election time window.")]
    InvalidElectionWindow,
    #[msg("Invalid SBT mint for this election.")]
    InvalidMint,
}
